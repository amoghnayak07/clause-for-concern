import { ReviewWorkspace } from "@/components/review/ReviewWorkspace";
import { DEMO_CLAUSES, DEMO_FINDINGS, DEMO_TEXT } from "@/features/viewer/fixture";

/** Static demo review until the streaming route is wired in. */
export default function HomePage() {
  return <ReviewWorkspace text={DEMO_TEXT} clauses={DEMO_CLAUSES} findings={DEMO_FINDINGS} />;
}
