import type { AvailableCampaignOption } from "./types";

export function MetaCampaignMultiSelect({
  campaigns,
  isLoading,
  selectedIds,
  onChange,
  disabledReason,
}: {
  campaigns: AvailableCampaignOption[];
  isLoading: boolean;
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  disabledReason: string | null;
}) {
  function toggle(id: string) {
    if (selectedIds.includes(id)) {
      onChange(selectedIds.filter((existing) => existing !== id));
    } else {
      onChange([...selectedIds, id]);
    }
  }

  if (disabledReason) {
    return <p className="text-xs text-muted-foreground">{disabledReason}</p>;
  }

  return (
    <div className="max-h-40 w-full max-w-md overflow-y-auto rounded-md border border-input bg-background p-1.5">
      {isLoading && <p className="px-1 py-0.5 text-xs text-muted-foreground">Carregando dados...</p>}
      {!isLoading && campaigns.length === 0 && (
        <p className="px-1 py-0.5 text-xs text-muted-foreground">Nenhuma Meta disponível para esta seleção.</p>
      )}
      {campaigns.map((campaign) => (
        <label
          key={campaign.goalCampaignId}
          className="flex cursor-pointer items-center gap-1.5 rounded px-1 py-0.5 text-xs hover:bg-secondary/50"
        >
          <input
            type="checkbox"
            checked={selectedIds.includes(campaign.goalCampaignId)}
            onChange={() => toggle(campaign.goalCampaignId)}
          />
          <span>{campaign.name}</span>
        </label>
      ))}
    </div>
  );
}
