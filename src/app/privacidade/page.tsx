import { LegalPage } from "@/components/legal-page";

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Política de Privacidade"
      description="Esta política resume como o CriaBot trata os dados necessários para oferecer a plataforma."
      sections={[
        {
          title: "Dados coletados",
          text: "Coletamos dados de cadastro, como nome, e-mail e telefone, além das configurações dos bots criados na plataforma.",
        },
        {
          title: "Como usamos os dados",
          text: "Os dados são usados para autenticação, segurança, funcionamento dos bots, suporte e melhoria do serviço.",
        },
        {
          title: "Segurança e compartilhamento",
          text: "Aplicamos controles de acesso por usuário e não vendemos dados pessoais. Fornecedores essenciais podem processar dados conforme necessário para operar o serviço.",
        },
        {
          title: "Seus direitos",
          text: "Você poderá solicitar correção ou exclusão dos seus dados, respeitando obrigações legais e registros indispensáveis à segurança da plataforma.",
        },
      ]}
    />
  );
}
