import express from "express";
import cors from "cors";
import jwt from "jsonwebtoken";
import multer from "multer";
import { randomUUID } from "node:crypto";
import { PrismaClient, Role, BatchStatus, Decision } from "@prisma/client";
import { resolveDistrictBatchStatus } from "./policy";
import { batchSchema, parseCandidateCsv } from "./validation";
const prisma=new PrismaClient(), app=express(), secret=process.env.JWT_SECRET||"local";
app.use(cors()); app.use(express.json({limit:"2mb"}));
const users=[["anika","Anika","CENTRE"],["dev","Dev","DISTRICT"],["meera","Meera","DISTRICT"],["kabir","Kabir","DISTRICT"],["neha","Neha","QUALITY"],["farah","Farah","STATE"]] as const;
async function seed(){for(const [username,name,role] of users) await prisma.user.upsert({where:{username},update:{},create:{username,name,role:role as Role,district:role==="DISTRICT"?"Demo District":undefined}});}
seed().catch(console.error);
app.get("/health",(_,res)=>res.json({ok:true}));
app.post("/api/login",async(req,res)=>{const u=await prisma.user.findUnique({where:{username:String(req.body.username)}});if(!u)return res.status(401).json({error:"Unknown demo user"});res.json({token:jwt.sign({id:u.id,username:u.username,role:u.role},secret),user:u});});
type Auth={id:string,username:string,role:Role};
function auth(req:any,res:any,next:any){try{const h=req.headers.authorization||"", token=h.startsWith("Bearer ")?h.slice(7):"";req.user=jwt.verify(token,secret) as Auth;next();}catch{return res.status(401).json({error:"Authentication required"});}}
function roles(...allowed:Role[]){return(req:any,res:any,next:any)=>allowed.includes(req.user.role)?next():res.status(403).json({error:"Not authorized for this action"});}
app.get("/api/me",auth,(req:any,res)=>res.json(req.user));
app.get("/api/batches",auth,async(req:any,res)=>{const where=req.user.role==="CENTRE"?{centreId:req.user.id}:{};res.json(await prisma.batch.findMany({where,include:{candidates:true,votes:true},orderBy:{createdAt:"desc"}}));});
app.get("/api/batches/stalled",auth,roles(Role.STATE),async(_req:any,res:any)=>{
  const staleBefore=new Date(Date.now()-48*60*60*1000);
  const batches=await prisma.batch.findMany({
    where:{
      status:{in:[BatchStatus.SUBMITTED,BatchStatus.DISTRICT_REVIEW,BatchStatus.QUALITY_REVIEW,BatchStatus.STATE_REVIEW]},
      updatedAt:{lt:staleBefore},
    },
    select:{id:true,name:true,status:true,size:true,updatedAt:true},
    orderBy:{updatedAt:"asc"},
  });
  res.json({thresholdHours:48,batches});
});
async function createBatch(user:any,name:string,candidates:any[]){
  return prisma.$transaction(async tx=>{
    const batch=await tx.batch.create({
      data:{name,centreId:user.id,size:candidates.length,candidates:{create:candidates}},
    });
    await tx.audit.create({
      data:{batchId:batch.id,actorId:user.id,action:"BATCH_CREATED"},
    });
    return batch;
  });
}
app.post("/api/batches",auth,roles(Role.CENTRE),async(req:any,res)=>{
  const parsed=batchSchema.safeParse(req.body);
  if(!parsed.success)return res.status(400).json({errors:parsed.error.issues});

  const emails=parsed.data.candidates.map(candidate=>candidate.email.toLowerCase());
  if(new Set(emails).size!==emails.length)return res.status(400).json({error:"Duplicate email within batch"});

  const batch=await createBatch(req.user,parsed.data.name,parsed.data.candidates);
  res.status(201).json(batch);
});
const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:2*1024*1024}});
app.post("/api/batches/import",auth,roles(Role.CENTRE),upload.single("file"),async(req:any,res)=>{if(!req.file)return res.status(400).json({error:"CSV file required"});const {candidates,errors}=parseCandidateCsv(req.file.buffer.toString("utf8"));if(errors.length)return res.status(400).json({error:"CSV validation failed; no rows imported",errors});const name=req.body.name||req.file.originalname;const b=await prisma.$transaction(async tx=>{const batch=await tx.batch.create({data:{name,centreId:req.user.id,size:candidates.length,candidates:{create:candidates}}});await tx.audit.create({data:{batchId:batch.id,actorId:req.user.id,action:"CSV_IMPORTED",detail:`${candidates.length} rows`}});return batch;});res.status(201).json(b);});
app.post("/api/batches/:id/submit",auth,roles(Role.CENTRE),async(req:any,res)=>{const b=await prisma.batch.findUnique({where:{id:req.params.id}});if(!b||b.centreId!==req.user.id)return res.status(404).json({error:"Batch not found"});if(!([BatchStatus.DRAFT,BatchStatus.RETURNED] as BatchStatus[]).includes(b.status))return res.status(409).json({error:"Batch cannot be submitted in current state"});await prisma.$transaction(async tx=>{await tx.vote.deleteMany({where:{batchId:b.id}});await tx.batch.update({where:{id:b.id},data:{status:BatchStatus.SUBMITTED,submittedAt:new Date()}});await tx.audit.create({data:{batchId:b.id,actorId:req.user.id,action:"BATCH_SUBMITTED"}});});res.json({ok:true});});
app.post("/api/batches/:id/district-vote",auth,roles(Role.DISTRICT),async(req:any,res)=>{
  const decision=req.body.decision as string;
  if(!["approve","reject","return"].includes(decision))return res.status(400).json({error:"Invalid decision"});

  const result=await prisma.$transaction(async tx=>{
    await tx.$queryRaw`SELECT "id" FROM "Batch" WHERE "id" = ${req.params.id} FOR UPDATE`;
    const batch=await tx.batch.findUnique({where:{id:req.params.id}});
    if(!batch||!([BatchStatus.SUBMITTED,BatchStatus.DISTRICT_REVIEW] as BatchStatus[]).includes(batch.status)){
      return {error:"Batch not in district review"} as const;
    }

    const existing=await tx.vote.findUnique({where:{batchId_userId:{batchId:batch.id,userId:req.user.id}}});
    if(existing)return {error:"Already voted"} as const;

    await tx.vote.create({
      data:{
        batchId:batch.id,
        userId:req.user.id,
        decision:decision.toUpperCase() as Decision,
        reason:req.body.reason,
      },
    });

    const votes=await tx.vote.findMany({where:{batchId:batch.id}});
    const status=resolveDistrictBatchStatus(batch.size,votes.map(v=>v.decision));

    await tx.batch.update({where:{id:batch.id},data:{status}});
    await tx.audit.create({
      data:{
        batchId:batch.id,
        actorId:req.user.id,
        action:"DISTRICT_VOTE",
        detail:`${decision}; ${status}`,
      },
    });
    return {status} as const;
  });

  if("error" in result)return res.status(409).json({error:result.error});
  res.json({ok:true,status:result.status});
});
app.post("/api/batches/:id/quality",auth,roles(Role.QUALITY),async(req:any,res)=>{const b=await prisma.batch.findUnique({where:{id:req.params.id}});if(!b||b.status!==BatchStatus.QUALITY_REVIEW)return res.status(409).json({error:"Not awaiting quality"});const status=req.body.decision==="approve"?BatchStatus.STATE_REVIEW:BatchStatus.RETURNED;await prisma.$transaction([prisma.batch.update({where:{id:b.id},data:{status}}),prisma.audit.create({data:{batchId:b.id,actorId:req.user.id,action:"QUALITY_DECISION",detail:status}})]);res.json({ok:true});});
app.post("/api/batches/:id/state",auth,roles(Role.STATE),async(req:any,res)=>{
  const decision=req.body.decision as string;
  if(!["approve","reject","return"].includes(decision)){
    return res.status(400).json({error:"Invalid decision"});
  }

  const batch=await prisma.batch.findUnique({
    where:{id:req.params.id},
    include:{candidates:true},
  });
  if(!batch||batch.status!==BatchStatus.STATE_REVIEW){
    return res.status(409).json({error:"Not awaiting state approval"});
  }

  const status=decision==="approve"
    ?BatchStatus.APPROVED
    :decision==="return"
      ?BatchStatus.RETURNED
      :BatchStatus.REJECTED;
  const applied=await prisma.$transaction(async tx=>{
    const updated=await tx.batch.updateMany({
      where:{id:batch.id,status:BatchStatus.STATE_REVIEW},
      data:{status},
    });
    if(updated.count===0)return false;

    if(decision==="approve"){
      for(const candidate of batch.candidates){
        const certificate=await tx.certificate.create({
          data:{
            candidateId:candidate.id,
            number:`CF-${randomUUID().slice(0,12).toUpperCase()}`,
            token:randomUUID(),
          },
        });
        await tx.delivery.create({data:{certificateId:certificate.id}});
      }
    }

    await tx.audit.create({
      data:{
        batchId:batch.id,
        actorId:req.user.id,
        action:decision==="approve"?"STATE_APPROVED":"STATE_DECISION",
        detail:decision==="approve"
          ?`${batch.candidates.length} certificates issued`
          :status,
      },
    });
    return true;
  });
  if(!applied)return res.status(409).json({error:"Batch decision was already applied"});

  res.json({
    ok:true,
    status,
    ...(decision==="approve"?{issued:batch.candidates.length}:{}),
  });
});
app.post("/api/certificates/:id/cancel",auth,roles(Role.STATE),async(req:any,res)=>{
  const cert=await prisma.certificate.findUnique({
    where:{id:req.params.id},
    include:{candidate:true},
  });
  if(!cert)return res.status(404).json({error:"Not found"});

  await prisma.$transaction([
    prisma.certificate.update({
      where:{id:cert.id},
      data:{status:"REVOKED",cancelledAt:new Date()},
    }),
    prisma.delivery.updateMany({
      where:{certificateId:cert.id,status:{in:["QUEUED","ENQUEUED","SENDING"]}},
      data:{status:"CANCELLED"},
    }),
    prisma.audit.create({
      data:{
        batchId:cert.candidate.batchId,
        actorId:req.user.id,
        action:"CERTIFICATE_REVOKED",
        detail:cert.number,
      },
    }),
  ]);
  res.json({ok:true});
});
app.get("/api/certificates", auth, async (req: any, res) => {
  const where =
    req.user.role === Role.CENTRE
      ? { candidate: { batch: { centreId: req.user.id } } }
      : {};

  const certificates = await prisma.certificate.findMany({
    where,
    include: {
      candidate: {
        include: {
          batch: true,
        },
      },
    },
    orderBy: {
      issuedAt: "desc",
    },
  });

  res.json(certificates);
});
app.get("/api/certificates/:token/verify",async(req,res)=>{const c=await prisma.certificate.findUnique({where:{token:req.params.token}});if(!c)return res.status(404).json({valid:false,status:"NOT_FOUND"});res.json({valid:c.status==="VALID",status:c.status,number:c.number,issuedAt:c.issuedAt});});
app.get("/api/audit/:batchId",auth,async(req:any,res)=>{const b=await prisma.batch.findUnique({where:{id:req.params.batchId}});if(!b)return res.status(404).json({error:"Not found"});if(req.user.role==="CENTRE"&&b.centreId!==req.user.id)return res.status(403).json({error:"Not allowed"});res.json(await prisma.audit.findMany({where:{batchId:b.id},orderBy:{createdAt:"asc"}}));});
app.listen(Number(process.env.PORT||4000),()=>console.log("CertiFlow API listening"));
