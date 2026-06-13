import { useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { uploadMedia } from "@/lib/api/admin.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Upload, Loader2, X } from "lucide-react";
import { toast } from "sonner";

type Props = {
  value: string;
  onChange: (url: string) => void;
  /** Mostra também um campo para colar um link externo. */
  allowUrl?: boolean;
  visibility?: "public" | "private";
};

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result);
      resolve(result.split(",")[1] ?? "");
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function ImageUpload({ value, onChange, allowUrl = true, visibility = "public" }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const upload = useServerFn(uploadMedia);
  const [loading, setLoading] = useState(false);

  async function handleFile(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Selecione um arquivo de imagem");
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      toast.error("Imagem muito grande (máx. 8MB)");
      return;
    }
    setLoading(true);
    try {
      const dataBase64 = await fileToBase64(file);
      const res = await upload({
        data: { filename: file.name, contentType: file.type as any, dataBase64, visibility },
      });
      onChange(res.url);
      toast.success("Imagem enviada");
    } catch (e: any) {
      toast.error(e.message ?? "Falha ao enviar imagem");
    } finally {
      setLoading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div className="space-y-2">
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => handleFile(e.target.files?.[0])}
      />
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => inputRef.current?.click()}
          disabled={loading}
        >
          {loading ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Upload className="mr-2 h-4 w-4" />
          )}
          Enviar foto
        </Button>
        {value ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => onChange("")}
            title="Remover imagem"
          >
            <X className="h-4 w-4" />
          </Button>
        ) : null}
      </div>

      {allowUrl ? (
        <Input
          placeholder="ou cole um link https://..."
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : null}

      {value && visibility === "public" ? (
        <img
          src={value}
          alt="Pré-visualização"
          className="mt-1 max-h-48 rounded-lg border border-border object-cover"
          onError={(e) => (e.currentTarget.style.display = "none")}
        />
      ) : null}
    </div>
  );
}
