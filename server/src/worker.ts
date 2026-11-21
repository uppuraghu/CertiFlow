import { Queue, Worker } from "bullmq";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const connection = {
  host: "redis",
  port: 6379,
};
const queue = new Queue("deliveries", { connection });

const worker = new Worker(
  "deliveries",
  async job => {
    const delivery = await prisma.delivery.findUnique({
      where: { certificateId: job.data.certificateId },
    });
    if (!delivery || ["SENT", "FAILED", "CANCELLED"].includes(delivery.status)) return;

    const certificate = await prisma.certificate.findUnique({
      where: { id: delivery.certificateId },
    });
    if (!certificate) {
      await prisma.delivery.update({
        where: { certificateId: delivery.certificateId },
        data: { status: "FAILED" },
      });
      return;
    }
    if (certificate.status !== "VALID") {
      await prisma.delivery.update({
        where: { certificateId: delivery.certificateId },
        data: { status: "CANCELLED" },
      });
      return;
    }

    const started = await prisma.delivery.updateMany({
      where: {
        certificateId: certificate.id,
        status: { in: ["QUEUED", "ENQUEUED", "SENDING"] },
      },
      data: { attempts: { increment: 1 }, status: "SENDING" },
    });
    if (started.count === 0) return;

    if (Math.random() < 0.2) {
      throw new Error("Simulated WhatsApp provider failure");
    }

    const delivered = await prisma.delivery.updateMany({
      where: { certificateId: certificate.id, status: "SENDING" },
      data: { status: "SENT", providerRef: `SIM-${certificate.id}` },
    });
    if (delivered.count > 0) console.log("Simulated WhatsApp sent", certificate.number);
  },
  { connection },
);

worker.on("failed", (job, error) => {
  console.warn("Delivery job failed", job?.id, error.message);
  if (!job || job.attemptsMade < (job.opts.attempts ?? 1)) return;

  void prisma.delivery.updateMany({
    where: { certificateId: job.data.certificateId, status: "SENDING" },
    data: { status: "FAILED" },
  }).then(({ count }) => {
    if (count === 0) {
      console.warn("No pending delivery record to mark failed", job.id);
    }
  }).catch(error => {
    console.error("Could not mark terminal delivery failure", job.id, error);
  });
});

let dispatching = false;

async function dispatchPendingDeliveries() {
  if (dispatching) return;
  dispatching = true;

  try {
    const retryBefore = new Date(Date.now() - 5 * 60 * 1000);
    await prisma.delivery.updateMany({
      where: { status: "SENDING", updatedAt: { lt: retryBefore } },
      data: { status: "QUEUED" },
    });

    const queued = await prisma.delivery.findMany({
      where: { status: "QUEUED" },
      select: { certificateId: true },
      orderBy: { updatedAt: "asc" },
      take: 100,
    });
    const enqueuedBefore = new Date(Date.now() - 30 * 1000);
    const retryEnqueued = await prisma.delivery.findMany({
      where: { status: "ENQUEUED", updatedAt: { lt: enqueuedBefore } },
      select: { certificateId: true },
      orderBy: { updatedAt: "asc" },
      take: 100,
    });

    for (const delivery of [...queued, ...retryEnqueued]) {
      try {
        await queue.add(
          "send",
          { certificateId: delivery.certificateId },
          {
            jobId: delivery.certificateId,
            attempts: 5,
            backoff: { type: "exponential", delay: 2000 },
          },
        );
        await prisma.delivery.updateMany({
          where: {
            certificateId: delivery.certificateId,
            status: { in: ["QUEUED", "ENQUEUED"] },
          },
          data: { status: "ENQUEUED" },
        });
      } catch (error) {
        console.error("Could not enqueue delivery", delivery.certificateId, error);
      }
    }
  } catch (error) {
    console.error("Could not dispatch pending delivery jobs", error);
  } finally {
    dispatching = false;
  }
}

void dispatchPendingDeliveries();
const dispatchTimer = setInterval(() => void dispatchPendingDeliveries(), 5000);
dispatchTimer.unref();

console.log("CertiFlow delivery worker ready");
