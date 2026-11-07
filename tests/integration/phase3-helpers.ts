import type { Prisma, PrismaClient, UserRole } from "@prisma/client";
import type { Actor } from "@/lib/permissions";

let counter = 0;

/** A real user record, returned as the Actor a signed-in request would carry. */
export async function createActor(prisma: PrismaClient, role: UserRole, permissionGrants: string[] = []): Promise<Actor> {
  counter += 1;
  const user = await prisma.user.create({ data: { email: `person-${counter}@example.com`, role, permissionGrants } });
  return { id: user.id, email: user.email, role, permissionGrants };
}

/** A topic the public can see. Pass overrides for a draft or archived one. */
export async function createPublishedTopic(prisma: PrismaClient, overrides: Partial<Prisma.TopicUncheckedCreateInput> = {}) {
  counter += 1;
  return prisma.topic.create({ data: { title: `موضوع ${counter}`, slug: `topic-${counter}`, status: "PUBLISHED", displayOrder: counter, ...overrides } });
}

/** A channel in the given topics. A video belongs to the topics of its channel. */
export async function createChannel(prisma: PrismaClient, topicIds: string[] = [], overrides: Partial<Prisma.YouTubeChannelUncheckedCreateInput> = {}) {
  counter += 1;
  const channel = await prisma.youTubeChannel.create({ data: { youtubeChannelId: `UC-test-${counter}`, title: `قناة ${counter}`, ...overrides } });
  for (const topicId of topicIds) await prisma.channelTopic.create({ data: { channelId: channel.id, topicId } });
  return channel;
}
