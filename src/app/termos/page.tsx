import { LegalPage } from "@/components/legal-page";

export default function TermsPage() {
  return (
    <LegalPage
      title="Termos de Uso"
      description="Ao criar uma conta, você concorda com as regras essenciais para uso responsável do CriaBot."
      sections={[
        {
          title: "Uso da plataforma",
          text: "O CriaBot pode ser usado para criar bots de vendas, atendimento e automação em atividades permitidas por lei e pelas regras dos canais conectados.",
        },
        {
          title: "Responsabilidade do usuário",
          text: "Você é responsável pelo conteúdo, produtos, mensagens, integrações e atendimento realizados pelos bots vinculados à sua conta.",
        },
        {
          title: "Usos proibidos",
          text: "Não é permitido usar a plataforma para fraude, spam, violação de direitos, produtos ilegais, malware ou qualquer atividade que prejudique terceiros.",
        },
        {
          title: "Suspensão e disponibilidade",
          text: "Contas que violem estes termos podem ser limitadas ou suspensas. Recursos podem evoluir e passar por manutenção para preservar segurança e qualidade.",
        },
      ]}
    />
  );
}
