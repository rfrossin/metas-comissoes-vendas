import type { GoalCampaign } from "./MetasPage";
import { GoalLinesSection } from "./GoalLinesSection";

export function CampaignDetail({ campaign }: { campaign: GoalCampaign }) {
  return (
    <div className="space-y-4 border-t border-border pt-4">
      <h2 className="text-lg font-semibold text-foreground">{campaign.name}</h2>

      <GoalLinesSection campaign={campaign} />
    </div>
  );
}
