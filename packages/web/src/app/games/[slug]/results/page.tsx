import { HouseGameRoute } from "../house-route";
export const metadata = {title:"Results — The House"};
export default async function GameResultsPage({params}: {params:Promise<{slug:string}>}) {
  return <HouseGameRoute slug={(await params).slug} mode="results" />;
}
