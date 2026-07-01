import { createFileRoute } from "@tanstack/react-router";
import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { PanelSubnav } from "@/components/PanelSubnav";
import { getImageBotStats } from "@/lib/api/admin.functions";

export const Route = createFileRoute("/_authenticated/$bot/estatisticas")({
  component: ImageBotStatistics,
});

type PeriodStats = {
  total: number;
  photos: number;
  videos: number;
  users: number;
};

type Stats = {
  delivered: {
    today: PeriodStats;
    week: PeriodStats;
    month: PeriodStats;
  };
  mediaTypeTotals: { photos: number; videos: number };
  popularFavorites: {
    id: string;
    category: "hetero" | "trans";
    media_type: "photo" | "video";
    caption: string | null;
    favorite_count: number;
  }[];
  activeUsers: { today: number; week: number; month: number };
  hourlyUsage: { hour: number; total: number }[];
  growth: { day: string; users: number; media: number; deliveries: number }[];
  blockRate: { totalUsers: number; blockedUsers: number; percent: number };
  telegramErrors: { today: number; week: number; month: number; monthRate: number };
};

type StatsSection = "summary" | "media" | "users" | "hours" | "growth" | "favorites";

const statsSections: { value: StatsSection; label: string }[] = [
  { value: "summary", label: "Resumo" },
  { value: "media", label: "Mídias" },
  { value: "users", label: "Usuários" },
  { value: "hours", label: "Horarios" },
  { value: "growth", label: "Crescimento" },
  { value: "favorites", label: "Favoritos" },
];

function ImageBotStatistics() {
  const statsFn = useServerFn(getImageBotStats);
  const { data } = useSuspenseQuery(
    queryOptions({ queryKey: ["image-bot-stats"], queryFn: () => statsFn() as Promise<Stats> }),
  );
  const [activeSection, setActiveSection] = useState<StatsSection>("summary");

  const maxHour = Math.max(1, ...data.hourlyUsage.map((item) => item.total));
  const maxGrowth = Math.max(
    1,
    ...data.growth.flatMap((item) => [item.users, item.media, item.deliveries]),
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-semibold">Estatisticas</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Entregas, favoritos, usuários ativos, horarios de uso, crescimento e erros do Telegram.
        </p>
      </div>

      <PanelSubnav items={statsSections} active={activeSection} onChange={setActiveSection} />

      <div
        className={
          activeSection !== "summary" ? "panel-section-hidden" : "grid gap-4 md:grid-cols-3"
        }
      >
        <PeriodCard title="Hoje" stats={data.delivered.today} />
        <PeriodCard title="Ultimos 7 dias" stats={data.delivered.week} />
        <PeriodCard title="Ultimos 30 dias" stats={data.delivered.month} />
      </div>

      <div
        className={
          activeSection !== "media" && activeSection !== "users"
            ? "panel-section-hidden"
            : "grid gap-4 lg:grid-cols-3"
        }
      >
        <Card className={activeSection !== "media" ? "panel-section-hidden" : "space-y-4 p-6"}>
          <h2 className="font-display text-xl font-semibold">Fotos versus vídeos</h2>
          <StackedBar
            leftLabel="Fotos"
            rightLabel="Vídeos"
            left={data.mediaTypeTotals.photos}
            right={data.mediaTypeTotals.videos}
          />
          <div className="grid grid-cols-2 gap-3 text-sm">
            <StatPill label="Fotos" value={data.mediaTypeTotals.photos} />
            <StatPill label="Vídeos" value={data.mediaTypeTotals.videos} />
          </div>
        </Card>

        <Card className={activeSection !== "users" ? "panel-section-hidden" : "space-y-4 p-6"}>
          <h2 className="font-display text-xl font-semibold">Usuários ativos</h2>
          <StatPill label="Hoje" value={data.activeUsers.today} />
          <StatPill label="Semana" value={data.activeUsers.week} />
          <StatPill label="Mes" value={data.activeUsers.month} />
        </Card>

        <Card className={activeSection !== "users" ? "panel-section-hidden" : "space-y-4 p-6"}>
          <h2 className="font-display text-xl font-semibold">Bloqueios e erros</h2>
          <StatPill
            label="Usuários bloqueados"
            value={`${data.blockRate.blockedUsers}/${data.blockRate.totalUsers}`}
          />
          <StatPill label="Taxa de bloqueio" value={`${data.blockRate.percent}%`} />
          <StatPill label="Erros Telegram hoje" value={data.telegramErrors.today} />
          <StatPill label="Taxa de erro no mes" value={`${data.telegramErrors.monthRate}%`} />
        </Card>
      </div>

      <div
        className={
          activeSection !== "hours" && activeSection !== "growth"
            ? "panel-section-hidden"
            : "grid gap-4 xl:grid-cols-2"
        }
      >
        <Card className={activeSection !== "hours" ? "panel-section-hidden" : "space-y-4 p-6"}>
          <h2 className="font-display text-xl font-semibold">Horarios de maior uso</h2>
          <div className="space-y-2">
            {Array.from({ length: 24 }, (_, hour) => {
              const total = data.hourlyUsage.find((item) => item.hour === hour)?.total ?? 0;
              return (
                <div
                  key={hour}
                  className="grid grid-cols-[48px_1fr_48px] items-center gap-3 text-sm"
                >
                  <span className="text-muted-foreground">{String(hour).padStart(2, "0")}h</span>
                  <div className="h-3 rounded-full bg-muted">
                    <div
                      className="h-3 rounded-full bg-primary"
                      style={{ width: `${Math.max(2, (total / maxHour) * 100)}%` }}
                    />
                  </div>
                  <span className="text-right tabular-nums">{total}</span>
                </div>
              );
            })}
          </div>
        </Card>

        <Card className={activeSection !== "growth" ? "panel-section-hidden" : "space-y-4 p-6"}>
          <h2 className="font-display text-xl font-semibold">Crescimento</h2>
          <div className="space-y-3">
            {data.growth.map((item) => (
              <div key={item.day} className="space-y-1">
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>{formatDay(item.day)}</span>
                  <span>
                    {item.users} usuários - {item.media} mídias - {item.deliveries} entregas
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-1">
                  <Bar value={item.users} max={maxGrowth} className="bg-blue-500" />
                  <Bar value={item.media} max={maxGrowth} className="bg-blue-300" />
                  <Bar value={item.deliveries} max={maxGrowth} className="bg-primary" />
                </div>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-2 text-xs">
            <Badge className="bg-blue-500">Usuários</Badge>
            <Badge className="bg-blue-300 text-foreground">Mídias</Badge>
            <Badge>Entregas</Badge>
          </div>
        </Card>
      </div>

      <Card className={activeSection !== "favorites" ? "panel-section-hidden" : "space-y-4 p-6"}>
        <h2 className="font-display text-xl font-semibold">Favoritos mais populares</h2>
        <div className="overflow-hidden rounded-3xl border">
          {data.popularFavorites.map((item, index) => (
            <div
              key={item.id}
              className="grid gap-3 border-b p-4 last:border-b-0 md:grid-cols-[48px_1fr_auto]"
            >
              <div className="text-2xl font-semibold text-primary">#{index + 1}</div>
              <div>
                <div className="font-medium">
                  {item.media_type === "photo" ? "Foto" : "Vídeo"} -{" "}
                  {item.category === "hetero" ? "Hetero" : "Trans"}
                </div>
                <p className="line-clamp-2 text-sm text-muted-foreground">
                  {item.caption || "Sem legenda"}
                </p>
              </div>
              <Badge variant="secondary">{item.favorite_count} favoritos</Badge>
            </div>
          ))}
          {!data.popularFavorites.length && (
            <p className="p-4 text-sm text-muted-foreground">Nenhum favorito registrado ainda.</p>
          )}
        </div>
      </Card>
    </div>
  );
}

function PeriodCard({ title, stats }: { title: string; stats: PeriodStats }) {
  return (
    <Card className="p-6">
      <h2 className="font-display text-lg font-semibold">{title}</h2>
      <div className="mt-4 text-3xl font-semibold">{stats.total}</div>
      <p className="mt-1 text-sm text-muted-foreground">mídias entregues</p>
      <div className="mt-5 grid grid-cols-3 gap-2 text-sm">
        <StatPill label="Fotos" value={stats.photos} />
        <StatPill label="Vídeos" value={stats.videos} />
        <StatPill label="Usuários" value={stats.users} />
      </div>
    </Card>
  );
}

function StackedBar({
  left,
  right,
  leftLabel,
  rightLabel,
}: {
  left: number;
  right: number;
  leftLabel: string;
  rightLabel: string;
}) {
  const total = Math.max(1, left + right);
  const leftPercent = (left / total) * 100;
  return (
    <div>
      <div className="flex h-4 overflow-hidden rounded-full bg-muted">
        <div className="bg-primary" style={{ width: `${leftPercent}%` }} />
        <div className="bg-blue-300" style={{ width: `${100 - leftPercent}%` }} />
      </div>
      <div className="mt-2 flex justify-between text-xs text-muted-foreground">
        <span>{leftLabel}</span>
        <span>{rightLabel}</span>
      </div>
    </div>
  );
}

function StatPill({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-2xl bg-muted p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 font-semibold">{value}</div>
    </div>
  );
}

function Bar({ value, max, className }: { value: number; max: number; className: string }) {
  return (
    <div className="h-2 rounded-full bg-muted">
      <div
        className={`h-2 rounded-full ${className}`}
        style={{ width: `${Math.max(2, (value / max) * 100)}%` }}
      />
    </div>
  );
}

function formatDay(day: string) {
  return new Date(`${day}T00:00:00`).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
  });
}
