import { PageUnavailable } from "./PageUnavailable";

/** A link that leads nowhere: never published, taken down, or never existed. Answered with a 404. */
export default function LookbookNotFound() {
  return <PageUnavailable />;
}
