import { CardHeader, DirectionOption, DirectionSelect, StatusPill } from "./ui";

interface DirectorControlsCardProps<
  EditGoal extends string,
  EditStyle extends string,
  BrollStyle extends string,
  CaptionStyle extends string,
> {
  editGoal: EditGoal;
  editStyle: EditStyle;
  brollStyle: BrollStyle;
  captionStyle: CaptionStyle;
  ctaContext: string;
  creativeDirection: string;
  brandNotes: string;
  editGoalOptions: Array<DirectionOption<EditGoal>>;
  editStyleOptions: Array<DirectionOption<EditStyle>>;
  brollStyleOptions: Array<DirectionOption<BrollStyle>>;
  captionStyleOptions: Array<DirectionOption<CaptionStyle>>;
  editStyleLabel: string;
  onEditGoalChange: (value: EditGoal) => void;
  onEditStyleChange: (value: EditStyle) => void;
  onBrollStyleChange: (value: BrollStyle) => void;
  onCaptionStyleChange: (value: CaptionStyle) => void;
  onCtaContextChange: (value: string) => void;
  onCreativeDirectionChange: (value: string) => void;
  onBrandNotesChange: (value: string) => void;
}

export function DirectorControlsCard<
  EditGoal extends string,
  EditStyle extends string,
  BrollStyle extends string,
  CaptionStyle extends string,
>({
  editGoal,
  editStyle,
  brollStyle,
  captionStyle,
  ctaContext,
  creativeDirection,
  brandNotes,
  editGoalOptions,
  editStyleOptions,
  brollStyleOptions,
  captionStyleOptions,
  editStyleLabel,
  onEditGoalChange,
  onEditStyleChange,
  onBrollStyleChange,
  onCaptionStyleChange,
  onCtaContextChange,
  onCreativeDirectionChange,
  onBrandNotesChange,
}: DirectorControlsCardProps<EditGoal, EditStyle, BrollStyle, CaptionStyle>) {
  return (
    <div className="rounded-3xl border border-border/70 bg-background/60 p-4">
      <CardHeader
        eyebrow="Director Controls"
        title="Edit Recipe"
        description="Steer the AI like an editor: goal, style, caption feel, and the offer context."
        action={<StatusPill tone="info" label={editStyleLabel} />}
      />
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <DirectionSelect
          label="Edit goal"
          value={editGoal}
          options={editGoalOptions}
          onChange={onEditGoalChange}
        />
        <DirectionSelect
          label="Edit style"
          value={editStyle}
          options={editStyleOptions}
          onChange={onEditStyleChange}
        />
        <DirectionSelect
          label="B-roll style"
          value={brollStyle}
          options={brollStyleOptions}
          onChange={onBrollStyleChange}
        />
        <DirectionSelect
          label="Caption style"
          value={captionStyle}
          options={captionStyleOptions}
          onChange={onCaptionStyleChange}
        />
      </div>
      <label className="mt-4 block text-sm">
        <span className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
          CTA / offer context
        </span>
        <input
          value={ctaContext}
          onChange={(event) => onCtaContextChange(event.target.value)}
          placeholder="Comment MONEY and I will DM you the quiz + webinar link."
          className="mt-2 w-full rounded-2xl border border-border/70 bg-card px-3 py-2 outline-none transition focus:border-primary"
        />
      </label>
      <label className="mt-4 block text-sm">
        <span className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
          Custom creative direction
        </span>
        <textarea
          value={creativeDirection}
          onChange={(event) => onCreativeDirectionChange(event.target.value)}
          placeholder="Make this feel like a premium money mentor reel. Avoid cheesy stock visuals."
          className="mt-2 min-h-[82px] w-full rounded-2xl border border-border/70 bg-card px-3 py-3 outline-none transition focus:border-primary"
        />
      </label>
      <label className="mt-4 block text-sm">
        <span className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
          Brand notes
        </span>
        <textarea
          value={brandNotes}
          onChange={(event) => onBrandNotesChange(event.target.value)}
          placeholder="Dark premium look, yellow highlight words, no emojis, confident tone."
          className="mt-2 min-h-[70px] w-full rounded-2xl border border-border/70 bg-card px-3 py-3 outline-none transition focus:border-primary"
        />
      </label>
    </div>
  );
}
