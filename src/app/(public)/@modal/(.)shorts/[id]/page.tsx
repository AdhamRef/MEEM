import { notFound } from "next/navigation";
import { VideoModal } from "@/components/video/video-modal";
import { VideoWatch } from "@/components/video/video-watch";
import { getPublicVideo } from "@/features/shorts/feed.service";

/** Only reached by following a link within the site. Opening the address directly shows the full feed. */
export default async function ShortModalPage({ params }: { params: Promise<{ id: string }> }) {
  const video = await getPublicVideo((await params).id);
  if (!video) notFound();

  return (
    <VideoModal>
      <VideoWatch video={video} />
    </VideoModal>
  );
}
