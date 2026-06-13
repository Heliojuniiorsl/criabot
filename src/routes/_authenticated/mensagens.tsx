import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery, queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import {
  listBroadcasts,
  saveBroadcast,
  deleteBroadcast,
  sendBroadcastNow,
} from "@/lib/api/admin.functions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Pencil, Trash2, Plus, Send, X } from "lucide-react";
import { toast } from "sonner";
import { ImageUpload } from "@/components/ImageUpload";

export const Route = createFileRoute("/_authenticated/mensagens")({
  component: Mensagens,
});

type BtnKind = "link" | "plans" | "contents" | "menu";
type Btn = { label: string; kind: BtnKind; url?: string | null };
type Broadcast = {
  id: string;
  title: string;
  message: string;
  image_url: string | null;
  buttons: Btn[];
  interval_hours: number;
  is_active: boolean;
  last_sent_at: string | null;
};

const kindLabel: Record<BtnKind, string> = {
  link: "Link externo",
  plans: "Abrir planos",
  contents: "Abrir conteúdos",
  menu: "Abrir menu",
};

function Mensagens() {
  const qc = useQueryClient();
  const listFn = useServerFn(listBroadcasts);
  const saveFn = useServerFn(saveBroadcast);
  const delFn = useServerFn(deleteBroadcast);
  const sendFn = useServerFn(sendBroadcastNow);

  const { data: items } = useSuspenseQuery(
    queryOptions({ queryKey: ["broadcasts"], queryFn: () => listFn() as Promise<Broadcast[]> }),
  );

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Broadcast | null>(null);
  const [imageUrl, setImageUrl] = useState("");
  const [buttons, setButtons] = useState<Btn[]>([]);

  const save = useMutation({
    mutationFn: (p: any) => saveFn({ data: p }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["broadcasts"] });
      setOpen(false);
      toast.success("Mensagem salva");
    },
    onError: (e: any) => toast.error(e.message),
  });
  const remove = useMutation({
    mutationFn: (id: string) => delFn({ data: { id } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["broadcasts"] });
      toast.success("Mensagem excluída");
    },
    onError: (e: any) => toast.error(e.message),
  });
  const sendNow = useMutation({
    mutationFn: (id: string) => sendFn({ data: { id } }),
    onSuccess: (r: any) => {
      qc.invalidateQueries({ queryKey: ["broadcasts"] });
      toast.success(`Enviada para ${r.sent} usuário(s)`);
    },
    onError: (e: any) => toast.error(e.message),
  });

  function openNew() {
    setEditing(null);
    setImageUrl("");
    setButtons([]);
    setOpen(true);
  }
  function openEdit(b: Broadcast) {
    setEditing(b);
    setImageUrl(b.image_url ?? "");
    setButtons(b.buttons ?? []);
    setOpen(true);
  }

  function addButton() {
    setButtons((prev) => [...prev, { label: "", kind: "plans", url: "" }]);
  }
  function updateButton(i: number, patch: Partial<Btn>) {
    setButtons((prev) => prev.map((b, idx) => (idx === i ? { ...b, ...patch } : b)));
  }
  function removeButton(i: number) {
    setButtons((prev) => prev.filter((_, idx) => idx !== i));
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const cleanButtons = buttons
      .filter((b) => b.label.trim())
      .map((b) => ({
        label: b.label.trim(),
        kind: b.kind,
        url: b.kind === "link" ? (b.url ?? "") : null,
      }));
    save.mutate({
      id: editing?.id,
      title: String(f.get("title")),
      message: String(f.get("message")),
      image_url: imageUrl || null,
      buttons: cleanButtons,
      interval_hours: Number(f.get("interval_hours")),
      is_active: f.get("is_active") === "on",
    });
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-3xl font-semibold">Mensagens automáticas</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Disparos periódicos para todos os usuários do bot — conteúdos, promoções, descontos e
            novos planos.
          </p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button onClick={openNew}>
              <Plus className="mr-2 h-4 w-4" /> Nova mensagem
            </Button>
          </DialogTrigger>
          <DialogContent className="max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{editing ? "Editar mensagem" : "Nova mensagem"}</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="title">Título (interno)</Label>
                <Input
                  id="title"
                  name="title"
                  required
                  defaultValue={editing?.title}
                  placeholder="Ex: Promoção de fim de semana"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="message">Descrição / texto da mensagem</Label>
                <Textarea
                  id="message"
                  name="message"
                  required
                  rows={4}
                  defaultValue={editing?.message ?? ""}
                  placeholder="Texto que o usuário vai receber..."
                />
              </div>
              <div className="space-y-2">
                <Label>Foto da mensagem</Label>
                <ImageUpload value={imageUrl} onChange={setImageUrl} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="interval_hours">Enviar a cada (horas)</Label>
                <Input
                  id="interval_hours"
                  name="interval_hours"
                  type="number"
                  min="1"
                  max="8760"
                  required
                  defaultValue={editing?.interval_hours ?? 24}
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Botões</Label>
                  <Button type="button" variant="outline" size="sm" onClick={addButton}>
                    <Plus className="mr-1 h-3 w-3" /> Botão
                  </Button>
                </div>
                {buttons.length === 0 && (
                  <p className="text-xs text-muted-foreground">
                    Nenhum botão. A mensagem será enviada apenas com texto/foto.
                  </p>
                )}
                <div className="space-y-3">
                  {buttons.map((b, i) => (
                    <div key={i} className="rounded-lg border border-border p-3 space-y-2">
                      <div className="flex items-center gap-2">
                        <Input
                          value={b.label}
                          onChange={(e) => updateButton(i, { label: e.target.value })}
                          placeholder="Texto do botão (ex: 💎 Ver planos)"
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => removeButton(i)}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                      <Select
                        value={b.kind}
                        onValueChange={(v) => updateButton(i, { kind: v as BtnKind })}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="plans">Abrir planos</SelectItem>
                          <SelectItem value="contents">Abrir conteúdos</SelectItem>
                          <SelectItem value="menu">Abrir menu</SelectItem>
                          <SelectItem value="link">Link externo</SelectItem>
                        </SelectContent>
                      </Select>
                      {b.kind === "link" && (
                        <Input
                          value={b.url ?? ""}
                          onChange={(e) => updateButton(i, { url: e.target.value })}
                          placeholder="https://..."
                        />
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Switch
                  id="is_active"
                  name="is_active"
                  defaultChecked={editing ? editing.is_active : true}
                />
                <Label htmlFor="is_active">Ativa</Label>
              </div>
              <DialogFooter>
                <Button type="submit" disabled={save.isPending}>
                  Salvar
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <Card className="mt-8 p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Título</TableHead>
              <TableHead>Intervalo</TableHead>
              <TableHead>Botões</TableHead>
              <TableHead>Último envio</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground">
                  Nenhuma mensagem automática.
                </TableCell>
              </TableRow>
            )}
            {items.map((b) => (
              <TableRow key={b.id}>
                <TableCell className="font-medium">{b.title}</TableCell>
                <TableCell>{b.interval_hours}h</TableCell>
                <TableCell>{b.buttons?.length ?? 0}</TableCell>
                <TableCell className="text-muted-foreground">
                  {b.last_sent_at ? new Date(b.last_sent_at).toLocaleString("pt-BR") : "—"}
                </TableCell>
                <TableCell>
                  <Badge variant={b.is_active ? "default" : "secondary"}>
                    {b.is_active ? "Ativa" : "Inativa"}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  <Button
                    variant="ghost"
                    size="icon"
                    title="Enviar agora"
                    disabled={sendNow.isPending}
                    onClick={() => {
                      if (confirm("Enviar agora para todos os usuários?")) sendNow.mutate(b.id);
                    }}
                  >
                    <Send className="h-4 w-4 text-primary" />
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => openEdit(b)}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => {
                      if (confirm("Excluir mensagem?")) remove.mutate(b.id);
                    }}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
