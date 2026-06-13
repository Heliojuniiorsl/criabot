import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/termos")({
  head: () => ({
    meta: [
      { title: "Termos e Regras — Plataforma +18" },
      {
        name: "description",
        content:
          "Termos de uso e regras da plataforma de conteúdo adulto. Apenas para maiores de 18 anos.",
      },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: Termos,
});

function Termos() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-16">
      <Link to="/" className="text-sm text-primary hover:underline">
        ← Voltar
      </Link>
      <h1 className="mt-6 font-display text-3xl font-semibold">Termos e Regras</h1>
      <div className="mt-8 space-y-6 text-sm leading-relaxed text-muted-foreground">
        <section>
          <h2 className="font-display text-lg text-foreground">1. Maioridade obrigatória (+18)</h2>
          <p className="mt-2">
            Este serviço é destinado exclusivamente a pessoas com 18 anos ou mais. Ao utilizar a
            plataforma e o bot, você declara e confirma ser maior de idade.
          </p>
        </section>
        <section>
          <h2 className="font-display text-lg text-foreground">2. Conteúdo proibido</h2>
          <p className="mt-2">
            É terminantemente proibido qualquer conteúdo envolvendo menores de idade, terceiros sem
            autorização, violência, exploração ou qualquer material ilegal. Violações resultam em
            encerramento imediato e podem ser comunicadas às autoridades.
          </p>
        </section>
        <section>
          <h2 className="font-display text-lg text-foreground">3. Pagamentos e acessos</h2>
          <p className="mt-2">
            O acesso ao conteúdo só é liberado após a confirmação do pagamento. As assinaturas
            possuem prazo de validade e o acesso é bloqueado ao vencimento.
          </p>
        </section>
        <section>
          <h2 className="font-display text-lg text-foreground">4. Privacidade</h2>
          <p className="mt-2">
            Tratamos seus dados de forma privada e segura. O conteúdo é pessoal e intransferível; o
            compartilhamento não autorizado é proibido.
          </p>
        </section>
      </div>
    </div>
  );
}
