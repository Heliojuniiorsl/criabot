import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery, queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { listContents, saveContent, deleteContent } from "@/lib/api/admin.functions";
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
import { Pencil, Trash2, Plus } from "lucide-react";
import { toast } from "sonner";
import { ImageUpload } from "@/components/ImageUpload";

const brl = (v: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);

export const Route = createFileRoute("/_authenticated/conteudos")({
  component: Conteudos,
});

type Content = {
  id: string;
  title: string;
  description: string | null;
  type: "foto" | "video" | "pacote";
  price: number;
  preview_url: string | null;
  file_url: string | null;
  is_active: boolean;
};

function Conteudos() {
  const qc = useQueryClient();
  const listFn = useServerFn(listContents);
  const saveFn = useServerFn(saveContent);
  const delFn = useServerFn(deleteContent);

  const { data: contents } = useSuspenseQuery(
    queryOptions({ queryKey: ["contents"], queryFn: () => listFn() as Promise<Content[]> }),
  );

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Content | null>(null);
  const [type, setType] = useState<Content["type"]>("foto");
  const [fileUrl, setFileUrl] = useState<string>("");
  const [previewUrl, setPreviewUrl] = useState<string>("");

  const save = useMutation({
    mutationFn: (p: any) => saveFn({ data: p }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["contents"] });
      setOpen(false);
      toast.success("Conteúdo salvo");
    },
    onError: (e: any) => toast.error(e.message),
  });
  const remove = useMutation({
    mutationFn: (id: string) => delFn({ data: { id } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["contents"] });
      toast.success("Conteúdo excluído");
    },
    onError: (e: any) => toast.error(e.message),
  });

  function openNew() {
    setEditing(null);
    setType("foto");
    setFileUrl("");
    setPreviewUrl("");
    setOpen(true);
  }
  function openEdit(c: Content) {
    setEditing(c);
    setType(c.type);
    setFileUrl(c.file_url ?? "");
    setPreviewUrl(c.preview_url ?? "");
    setOpen(true);
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    save.mutate({
      id: editing?.id,
      title: String(f.get("title")),
      description: String(f.get("description") || ""),
      type,
      price: Number(f.get("price")),
      preview_url: previewUrl,
      file_url: fileUrl,
      is_active: f.get("is_active") === "on",
    });
  }

  const typeLabel: Record<string, string> = { foto: "Foto", video: "Vídeo", pacote: "Pacote" };

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-3xl font-semibold">Conteúdos</h1>
          <p className="mt-1 text-sm text-muted-foreground">Fotos, vídeos e pacotes avulsos.</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button onClick={openNew}>
              <Plus className="mr-2 h-4 w-4" /> Novo conteúdo
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editing ? "Editar conteúdo" : "Novo conteúdo"}</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="title">Título</Label>
                <Input id="title" name="title" required defaultValue={editing?.title} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="description">Descrição</Label>
                <Textarea
                  id="description"
                  name="description"
                  defaultValue={editing?.description ?? ""}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Tipo</Label>
                  <Select value={type} onValueChange={(v) => setType(v as Content["type"])}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="foto">Foto</SelectItem>
                      <SelectItem value="video">Vídeo</SelectItem>
                      <SelectItem value="pacote">Pacote</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="price">Preço (R$)</Label>
                  <Input
                    id="price"
                    name="price"
                    type="number"
                    step="0.01"
                    min="0"
                    required
                    defaultValue={editing?.price}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Prévia pública</Label>
                <p className="text-xs text-muted-foreground">Imagem mostrada antes da compra.</p>
                <ImageUpload value={previewUrl} onChange={setPreviewUrl} />
              </div>
              <div className="space-y-2">
                <Label>Arquivo entregue após o pagamento</Label>
                <p className="text-xs text-muted-foreground">
                  Fica privado e recebe um link temporário na entrega.
                </p>
                <ImageUpload value={fileUrl} onChange={setFileUrl} visibility="private" allowUrl />
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  id="is_active"
                  name="is_active"
                  defaultChecked={editing ? editing.is_active : true}
                />
                <Label htmlFor="is_active">Ativo</Label>
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
              <TableHead>Tipo</TableHead>
              <TableHead>Preço</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {contents.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground">
                  Nenhum conteúdo cadastrado.
                </TableCell>
              </TableRow>
            )}
            {contents.map((c) => (
              <TableRow key={c.id}>
                <TableCell className="font-medium">{c.title}</TableCell>
                <TableCell>{typeLabel[c.type]}</TableCell>
                <TableCell>{brl(c.price)}</TableCell>
                <TableCell>
                  <Badge variant={c.is_active ? "default" : "secondary"}>
                    {c.is_active ? "Ativo" : "Inativo"}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  <Button variant="ghost" size="icon" onClick={() => openEdit(c)}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => {
                      if (confirm("Excluir conteúdo?")) remove.mutate(c.id);
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
