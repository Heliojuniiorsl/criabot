import { cn } from "@/lib/utils";

type BrandMarkProps = {
  compact?: boolean;
  className?: string;
  imageClassName?: string;
  textClassName?: string;
  subtitle?: string;
};

export function BrandMark({
  compact = false,
  className,
  imageClassName,
  textClassName,
  subtitle,
}: BrandMarkProps) {
  return (
    <div className={cn("flex items-center gap-3", className)}>
      <img
        src="/criabot-mark.png"
        alt="CriaBot"
        className={cn("h-11 w-11 rounded-2xl object-cover shadow-sm", imageClassName)}
      />
      {!compact && (
        <div className="min-w-0">
          <div className={cn("font-display text-lg font-semibold text-primary", textClassName)}>
            CriaBot
          </div>
          {subtitle ? (
            <div className="truncate text-xs text-muted-foreground">{subtitle}</div>
          ) : null}
        </div>
      )}
    </div>
  );
}
