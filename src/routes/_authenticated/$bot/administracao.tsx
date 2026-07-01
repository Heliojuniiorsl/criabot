import { createFileRoute } from "@tanstack/react-router";
import { queryOptions, useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import {
  exportImageBotDatabaseBackup,
  listImageBotAdmins,
  listImageBotAuditLogs,
  listImageBotTrash,
  removeImageBotAdmin,
  restoreImageBotDatabaseBackup,
  restoreImageBotTrashMedia,
  saveImageBotAdmin,
} from "@/lib/api/admin.functions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { PanelSubnav } from "@/components/PanelSubnav";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/$bot/administracao")({
  component: ImageBotAdministration,
});

type AdminRow = {
  telegram_user_id: number;
  username: string | null;
  first_name: string | null;
  last_name: string | null;
  role: "owner" | "manager" | "moderator" | "viewer";
  can_delete_media: boolean;
  can_restore_media: boolean;
  can_manage_users: boolean;
  can_manage_settings: boolean;
  can_view_stats: boolean;
};

type TrashMedia = {
  id: string;
  category: "hetero" | "trans";
  media_type: "photo" | "video";
  caption: string | null;
  deleted_at: string | null;
  deleted_by: string | null;
  favorite_count: number;
  delivery_count: number;
};

type AuditLog = {
  id: string;
  actor_type: string;
  actor_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  details: string | null;
  created_at: string;
};

const roleLabels: Record<AdminRow["role"], string> = {
  owner: "Dono",
  manager: "Gerente",
  moderator: "Moderador",
  viewer: "Visualizador",
};

const permissionLabels = [
  ["can_delete_media", "Excluir mídias"],
  ["can_restore_media", "Restaurar lixeira"],
  ["can_manage_users", "Gerenciar usuários"],
  ["can_manage_settings", "Configurações"],
  ["can_view_stats", "Ver estatísticas"],
] as const;

type AdminSection = "admins" | "trash" | "backup" | "audit";

const adminSections: { value: AdminSection; label: string }[] = [
  { value: "admins", label: "Administradores" },
  { value: "trash", label: "Lixeira" },
  { value: "backup", label: "Backup" },
  { value: "audit", label: "Histórico" },
];

function ImageBotAdministration() {
  const qc = useQueryClient();
  const adminsFn = useServerFn(listImageBotAdmins);
  const trashFn = useServerFn(listImageBotTrash);
  const auditFn = useServerFn(listImageBotAuditLogs);
  const saveAdminFn = useServerFn(saveImageBotAdmin);
  const removeAdminFn = useServerFn(removeImageBotAdmin);
  const restoreMediaFn = useServerFn(restoreImageBotTrashMedia);
  const backupFn = useServerFn(exportImageBotDatabaseBackup);
  const restoreBackupFn = useServerFn(restoreImageBotDatabaseBackup);

  const { data: admins } = useSuspenseQuery(
    queryOptions({
      queryKey: ["image-bot-admins"],
      queryFn: () => adminsFn() as Promise<AdminRow[]>,
    }),
  );
  const { data: trash } = useSuspenseQuery(
    queryOptions({
      queryKey: ["image-bot-trash"],
      queryFn: () => trashFn() as Promise<TrashMedia[]>,
    }),
  );
  const { data: auditLogs } = useSuspenseQuery(
    queryOptions({
      queryKey: ["image-bot-audit"],
      queryFn: () => auditFn() as Promise<AuditLog[]>,
    }),
  );

  const [telegramId, setTelegramId] = useState("");
  const [role, setRole] = useState<AdminRow["role"]>("moderator");
  const [permissions, setPermissions] = useState({
    can_delete_media: true,
    can_restore_media: true,
    can_manage_users: false,
    can_manage_settings: false,
    can_view_stats: true,
  });
  const [activeSection, setActiveSection] = useState<AdminSection>("admins");
  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  const [restoreConfirmation, setRestoreConfirmation] = useState("");

  const refreshAdministration = () => {
    qc.invalidateQueries({ queryKey: ["image-bot-admins"] });
    qc.invalidateQueries({ queryKey: ["image-bot-trash"] });
    qc.invalidateQueries({ queryKey: ["image-bot-audit"] });
    qc.invalidateQueries({ queryKey: ["image-bot-media"] });
    qc.invalidateQueries({ queryKey: ["image-bot-dashboard"] });
  };

  const saveAdminMutation = useMutation({
    mutationFn: () =>
      saveAdminFn({
        data: {
          telegram_user_id: Number(telegramId),
          role,
          ...permissions,
        },
      }),
    onSuccess: () => {
      toast.success("Administrador salvo");
      setTelegramId("");
      refreshAdministration();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const removeAdminMutation = useMutation({
    mutationFn: (id: number) => removeAdminFn({ data: { telegram_user_id: id } }),
    onSuccess: () => {
      toast.success("Administrador removido");
      refreshAdministration();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const restoreMediaMutation = useMutation({
    mutationFn: (id: string) => restoreMediaFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Mídia restaurada");
      refreshAdministration();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const exportBackup = useMutation({
    mutationFn: () => backupFn() as Promise<{ filename: string; data_base64: string }>,
    onSuccess: (backup) => {
      const link = document.createElement("a");
      link.href = `data:application/octet-stream;base64,${backup.data_base64}`;
      link.download = backup.filename;
      link.click();
      toast.success("Backup gerado");
      qc.invalidateQueries({ queryKey: ["image-bot-audit"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const restoreBackup = useMutation({
    mutationFn: async () => {
      if (!restoreFile) throw new Error("Escolha um arquivo .sqlite");
      const dataBase64 = await fileToBase64(restoreFile);
      return restoreBackupFn({
        data: {
          filename: restoreFile.name,
          data_base64: dataBase64,
          confirmation: "RESTAURAR BANCO",
        },
      });
    },
    onSuccess: () => {
      toast.success("Backup restaurado");
      setRestoreFile(null);
      setRestoreConfirmation("");
      refreshAdministration();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  function submitAdmin(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!Number(telegramId)) {
      toast.error("Informe um ID do Telegram válido");
      return;
    }
    if (!window.confirm("Confirmar alteração dé administrador e permissões?")) return;
    saveAdminMutation.mutate();
  }

  function confirmRemoveAdmin(id: number) {
    if (!window.confirm("Remover esté administrador?")) return;
    removeAdminMutation.mutate(id);
  }

  function confirmRestoreMedia(id: string) {
    if (!window.confirm("Restaurar esta mídia da lixeira?")) return;
    restoreMediaMutation.mutate(id);
  }

  function submitRestoreBackup(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (restoreConfirmation !== "RESTAURAR BANCO") {
      toast.error('Digite "RESTAURAR BANCO" para confirmar');
      return;
    }
    if (!window.confirm("Isso vai substituir os dados atuais do UpMídias. Continuar?")) return;
    restoreBackup.mutate();
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-semibold">Administração</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Permissões, lixeira, histórico de alterações e backup do banco do UpMídias.
        </p>
      </div>

      <PanelSubnav items={adminSections} active={activeSection} onChange={setActiveSection} />

      <Card className={activeSection !== "admins" ? "panel-section-hidden" : "space-y-4 p-6"}>
        <h2 className="font-display text-xl font-semibold">Administradores</h2>
        <form onSubmit={submitAdmin} className="grid gap-4 lg:grid-cols-[180px_180px_1fr_auto]">
          <div className="space-y-2">
            <Label>ID Telegram</Label>
            <Input value={telegramId} onChange={(event) => setTelegramId(event.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Cargo</Label>
            <select
              className="h-10 w-full rounded-full border bg-background px-3 text-sm"
              value={role}
              onChange={(event) => setRole(event.target.value as AdminRow["role"])}
            >
              {Object.entries(roleLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {permissionLabels.map(([key, label]) => (
              <label key={key} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={permissions[key]}
                  onChange={(event) =>
                    setPermissions((current) => ({ ...current, [key]: event.target.checked }))
                  }
                />
                {label}
              </label>
            ))}
          </div>
          <div className="flex items-end">
            <Button type="submit" disabled={saveAdminMutation.isPending}>
              Salvar
            </Button>
          </div>
        </form>
        <div className="overflow-hidden rounded-3xl border">
          {admins.map((admin) => (
            <div
              key={admin.telegram_user_id}
              className="grid gap-3 border-b p-4 last:border-b-0 lg:grid-cols-[1fr_140px_1fr_auto]"
            >
              <div>
                <div className="font-medium">
                  {[admin.first_name, admin.last_name].filter(Boolean).join(" ") ||
                    `ID ${admin.telegram_user_id}`}
                </div>
                <div className="text-xs text-muted-foreground">
                  {admin.username ? `@${admin.username}` : "sem username"} ·{" "}
                  {admin.telegram_user_id}
                </div>
              </div>
              <Badge variant="secondary">{roleLabels[admin.role]}</Badge>
              <div className="flex flex-wrap gap-1">
                {permissionLabels
                  .filter(([key]) => admin[key])
                  .map(([, label]) => (
                    <Badge key={label} variant="outline">
                      {label}
                    </Badge>
                  ))}
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => confirmRemoveAdmin(admin.telegram_user_id)}
              >
                Remover
              </Button>
            </div>
          ))}
          {!admins.length && (
            <p className="p-4 text-sm text-muted-foreground">Nenhum administrador.</p>
          )}
        </div>
      </Card>

      <Card className={activeSection !== "trash" ? "panel-section-hidden" : "space-y-4 p-6"}>
        <h2 className="font-display text-xl font-semibold">Lixeira de mídias</h2>
        <div className="overflow-hidden rounded-3xl border">
          {trash.map((media) => (
            <div
              key={media.id}
              className="grid gap-3 border-b p-4 last:border-b-0 md:grid-cols-[1fr_auto]"
            >
              <div>
                <div className="font-medium">
                  {media.media_type === "photo" ? "Foto" : "Vídeo"} ·{" "}
                  {media.category === "hetero" ? "Hétero" : "Trans"}
                </div>
                <p className="line-clamp-2 text-sm text-muted-foreground">
                  {media.caption || "Sem legenda"}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Excluída em {formatDate(media.deleted_at)} por{" "}
                  {media.deleted_by || "desconhecido"}
                  {" · "}
                  {media.delivery_count} entregas · {media.favorite_count} favoritos
                </p>
              </div>
              <Button
                variant="outline"
                onClick={() => confirmRestoreMedia(media.id)}
                disabled={restoreMediaMutation.isPending}
              >
                Restaurar
              </Button>
            </div>
          ))}
          {!trash.length && <p className="p-4 text-sm text-muted-foreground">Lixeira vazia.</p>}
        </div>
      </Card>

      <Card className={activeSection !== "backup" ? "panel-section-hidden" : "space-y-4 p-6"}>
        <h2 className="font-display text-xl font-semibold">Backup e restauração</h2>
        <div className="flex flex-wrap gap-3">
          <Button onClick={() => exportBackup.mutate()} disabled={exportBackup.isPending}>
            Baixar backup
          </Button>
        </div>
        <form onSubmit={submitRestoreBackup} className="grid gap-4 md:grid-cols-[1fr_220px_auto]">
          <Input
            type="file"
            accept=".sqlite,.db,application/octet-stream"
            onChange={(event) => setRestoreFile(event.target.files?.[0] ?? null)}
          />
          <Input
            value={restoreConfirmation}
            onChange={(event) => setRestoreConfirmation(event.target.value)}
            placeholder="RESTAURAR BANCO"
          />
          <Button variant="destructive" disabled={restoreBackup.isPending}>
            Restaurar
          </Button>
        </form>
        <p className="text-xs text-muted-foreground">
          Restauração é uma ação importante: baixe um backup atual antes de substituir o banco.
        </p>
      </Card>

      <Card className={activeSection !== "audit" ? "panel-section-hidden" : "space-y-4 p-6"}>
        <h2 className="font-display text-xl font-semibold">Histórico de alterações</h2>
        <div className="overflow-hidden rounded-3xl border">
          {auditLogs.map((log) => (
            <div
              key={log.id}
              className="grid gap-2 border-b p-4 last:border-b-0 md:grid-cols-[180px_1fr]"
            >
              <div className="text-xs text-muted-foreground">{formatDate(log.created_at)}</div>
              <div>
                <div className="font-medium">{log.action}</div>
                <div className="text-xs text-muted-foreground">
                  {log.actor_type}:{log.actor_id || "desconhecido"} · {log.entity_type}
                  {log.entity_id ? `:${log.entity_id}` : ""}
                </div>
                {log.details && (
                  <pre className="mt-2 overflow-auto rounded-2xl bg-muted p-3 text-xs">
                    {log.details}
                  </pre>
                )}
              </div>
            </div>
          ))}
          {!auditLogs.length && (
            <p className="p-4 text-sm text-muted-foreground">Sem alterações registradas.</p>
          )}
        </div>
      </Card>
    </div>
  );
}

function fileToBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(new Error("Não foi possível ler o arquivo"));
    reader.readAsDataURL(file);
  });
}

function formatDate(value: string | null) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}
