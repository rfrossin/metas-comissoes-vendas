-- CreateEnum
CREATE TYPE "CompanyStatus" AS ENUM ('ATIVA', 'BLOQUEADA_INADIMPLENCIA');

-- CreateEnum
CREATE TYPE "PlatformRole" AS ENUM ('SUPER_ADMIN', 'SUPORTE');

-- CreateEnum
CREATE TYPE "PermissionLevel" AS ENUM ('OPERACIONAL', 'LIDERANCA_NO', 'ADMINISTRADOR');

-- CreateEnum
CREATE TYPE "AccessLevel" AS ENUM ('VISUALIZAR', 'EDITAR');

-- CreateEnum
CREATE TYPE "InviteStatus" AS ENUM ('PENDENTE', 'ACEITO', 'EXPIRADO', 'CANCELADO');

-- CreateEnum
CREATE TYPE "MemberStatus" AS ENUM ('ATIVO', 'INATIVO');

-- CreateEnum
CREATE TYPE "MemberType" AS ENUM ('OPERADOR', 'GESTOR');

-- CreateEnum
CREATE TYPE "OrgNodeType" AS ENUM ('EMPRESA', 'CANAL', 'DEPARTAMENTO', 'TIME');

-- CreateEnum
CREATE TYPE "ResultUnit" AS ENUM ('MOEDA', 'NUMERAL');

-- CreateEnum
CREATE TYPE "PeriodStatus" AS ENUM ('ABERTO', 'FECHADO');

-- CreateEnum
CREATE TYPE "SeasonalityAnalysisType" AS ENUM ('DIAS_SEMANA', 'DIAS_ANO', 'DIAS_MES', 'MESES_ANO', 'MESES_DIAS_SEMANA', 'MESES_DIAS_MES', 'TRIMESTRES');

-- CreateEnum
CREATE TYPE "OrgScopeType" AS ENUM ('EMPRESA', 'CANAL', 'DEPARTAMENTO', 'TIME', 'MEMBRO');

-- CreateEnum
CREATE TYPE "GoalCampaignStatus" AS ENUM ('ATIVA', 'INATIVA', 'ENCERRADA');

-- CreateEnum
CREATE TYPE "GoalEngineType" AS ENUM ('CRESCIMENTO_MENSAL', 'CRESCIMENTO_TRIMESTRAL', 'VALOR_ALVO_ANUAL', 'MANUAL', 'AGRUPAMENTO');

-- CreateEnum
CREATE TYPE "ReceivablesIndicatorType" AS ENUM ('META', 'RESULTADO');

-- CreateEnum
CREATE TYPE "ReceivablesPeriodicity" AS ENUM ('DIARIO', 'SEMANAL', 'MENSAL', 'TRIMESTRAL', 'ANUAL');

-- CreateEnum
CREATE TYPE "TriggerMode" AS ENUM ('FAIXA', 'CUMULATIVO');

-- CreateEnum
CREATE TYPE "ReceivablesStatus" AS ENUM ('ATIVO', 'DESATIVADO', 'ENCERRADO');

-- CreateEnum
CREATE TYPE "RewardType" AS ENUM ('PERCENT_FIXO', 'PERCENT_RESULTADO', 'VALOR_FIXO', 'PREMIO_FISICO');

-- CreateEnum
CREATE TYPE "BenefitApprovalStatus" AS ENUM ('APROVADO', 'REPROVADO');

-- CreateEnum
CREATE TYPE "ClosureAction" AS ENUM ('FECHAMENTO', 'REABERTURA');

-- CreateTable
CREATE TABLE "companies" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "CompanyStatus" NOT NULL DEFAULT 'ATIVA',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "companies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_users" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "PlatformRole" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "PermissionLevel" NOT NULL,
    "memberId" TEXT,
    "canLaunchOwnMemberResults" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_scope_assignments" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "scopeType" "OrgScopeType" NOT NULL,
    "scopeId" TEXT,
    "accessLevel" "AccessLevel" NOT NULL,

    CONSTRAINT "user_scope_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invites" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "cargoId" TEXT,
    "teamId" TEXT,
    "memberId" TEXT,
    "status" "InviteStatus" NOT NULL DEFAULT 'PENDENTE',
    "token" TEXT NOT NULL,
    "invitedByUserId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "channels" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "channels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "departments" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "departments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "teams" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "departmentId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "teams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "members" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "teamId" TEXT,
    "cargoId" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "status" "MemberStatus" NOT NULL DEFAULT 'ATIVO',
    "memberType" "MemberType" NOT NULL DEFAULT 'OPERADOR',
    "customFixedSalary" DECIMAL(14,2),
    "inactivatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "node_responsibles" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "nodeType" "OrgNodeType" NOT NULL,
    "channelId" TEXT,
    "departmentId" TEXT,
    "teamId" TEXT,
    "memberId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "node_responsibles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cargos" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "defaultFixedSalary" DECIMAL(14,2) NOT NULL,
    "permissionLevel" "PermissionLevel" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cargos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "result_types" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "unit" "ResultUnit" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "result_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "result_entries" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "typeId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "value" DECIMAL(18,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "result_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "operational_adjustments" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "typeId" TEXT NOT NULL,
    "value" DECIMAL(18,2) NOT NULL,
    "dateReference" DATE NOT NULL,
    "reason" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "operational_adjustments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_mappings" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "sourceLabel" TEXT NOT NULL,
    "typeId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "import_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commercial_periods" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "referenceMonth" DATE NOT NULL,
    "status" "PeriodStatus" NOT NULL DEFAULT 'ABERTO',
    "closedAt" TIMESTAMP(3),
    "closedByUserId" TEXT,
    "reopenedAt" TIMESTAMP(3),
    "reopenedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "commercial_periods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seasonality_bases" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "resultTypeId" TEXT NOT NULL,
    "analysisType" "SeasonalityAnalysisType" NOT NULL,
    "scopeType" "OrgScopeType" NOT NULL,
    "scopeId" TEXT,
    "startDate" DATE,
    "endDate" DATE,
    "isManual" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "seasonality_bases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seasonality_weights" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "seasonalityBaseId" TEXT NOT NULL,
    "referenceMonth" INTEGER,
    "referenceKey" INTEGER NOT NULL,
    "weight" DECIMAL(9,6) NOT NULL,

    CONSTRAINT "seasonality_weights_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goal_campaigns" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "resultTypeId" TEXT NOT NULL,
    "status" "GoalCampaignStatus" NOT NULL DEFAULT 'ATIVA',
    "inactivatedAt" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdByUserId" TEXT,

    CONSTRAINT "goal_campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goal_triggers" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "goalCampaignId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "percentage" DECIMAL(7,2) NOT NULL,
    "colorFlag" TEXT NOT NULL,

    CONSTRAINT "goal_triggers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goal_lines" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "goalCampaignId" TEXT NOT NULL,
    "entityType" "OrgScopeType" NOT NULL,
    "entityId" TEXT NOT NULL,
    "memberId" TEXT,
    "teamId" TEXT,
    "departmentId" TEXT,
    "channelId" TEXT,
    "seasonalityBaseId" TEXT,
    "dailySeasonalityBaseId" TEXT,
    "engineType" "GoalEngineType" NOT NULL,
    "initialValue" DECIMAL(18,2),
    "growthRate" DECIMAL(9,6),
    "groupDiscountPercentage" DECIMAL(7,4),
    "isManualOverride" BOOLEAN NOT NULL DEFAULT false,
    "inactivatedAt" DATE,
    "recalculatedFromLineId" TEXT,
    "appliedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "goal_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goal_line_group_sources" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "goalLineId" TEXT NOT NULL,
    "sourceGoalCampaignId" TEXT NOT NULL,
    "sourceEntityType" "OrgScopeType" NOT NULL,
    "sourceEntityId" TEXT NOT NULL,

    CONSTRAINT "goal_line_group_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goal_daily_values" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "goalLineId" TEXT NOT NULL,
    "memberId" TEXT,
    "date" DATE NOT NULL,
    "value" DECIMAL(18,2) NOT NULL,

    CONSTRAINT "goal_daily_values_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "receivables_bases" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "indicatorType" "ReceivablesIndicatorType" NOT NULL DEFAULT 'META',
    "primaryGoalCampaignId" TEXT,
    "resultTypeId" TEXT,
    "periodicity" "ReceivablesPeriodicity" NOT NULL,
    "triggerMode" "TriggerMode" NOT NULL,
    "status" "ReceivablesStatus" NOT NULL DEFAULT 'ATIVO',
    "startDate" DATE,
    "endDate" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdByUserId" TEXT,

    CONSTRAINT "receivables_bases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "receivables_value_tiers" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "receivablesBaseId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "thresholdValue" DECIMAL(18,2) NOT NULL,

    CONSTRAINT "receivables_value_tiers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "receivables_beneficiaries" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "receivablesBaseId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "entityType" "OrgScopeType" NOT NULL,
    "entityId" TEXT NOT NULL,

    CONSTRAINT "receivables_beneficiaries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "receivables_conditional_triggers" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "receivablesBaseId" TEXT NOT NULL,
    "verificationLevel" "OrgScopeType" NOT NULL,
    "indicatorType" "ReceivablesIndicatorType" NOT NULL DEFAULT 'META',
    "conditionalGoalCampaignId" TEXT,
    "resultTypeId" TEXT,
    "minAttainmentPercentage" DECIMAL(7,2),
    "minResultValue" DECIMAL(18,2),
    "applicableMemberIds" TEXT[] DEFAULT ARRAY[]::TEXT[],

    CONSTRAINT "receivables_conditional_triggers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "receivables_tier_rules" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "receivablesBaseId" TEXT NOT NULL,
    "valueTierId" TEXT NOT NULL,
    "rewardType" "RewardType" NOT NULL,
    "rewardResultTypeId" TEXT,
    "rewardPercentage" DECIMAL(7,4),
    "rewardFixedValue" DECIMAL(18,2),
    "rewardDescription" TEXT,

    CONSTRAINT "receivables_tier_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "member_closings" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "referenceMonth" DATE NOT NULL,
    "teamId" TEXT,
    "departmentId" TEXT,
    "channelId" TEXT,
    "cargoId" TEXT NOT NULL,
    "fixedSalarySnapshot" DECIMAL(14,2) NOT NULL,
    "benefitsByType" JSONB NOT NULL,
    "resultsByType" JSONB NOT NULL,
    "campaignsSummaryText" TEXT NOT NULL,
    "totalValue" DECIMAL(18,2) NOT NULL,
    "manualAdjustmentValue" DECIMAL(18,2),
    "manualAdjustmentReason" TEXT,
    "comments" TEXT,
    "closedAt" TIMESTAMP(3) NOT NULL,
    "closedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "member_closings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "snapshot_periodo_financeiro" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "memberClosingId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "receivablesBaseId" TEXT NOT NULL,
    "periodStart" DATE NOT NULL,
    "periodEndExclusive" DATE NOT NULL,
    "realizedNetValue" DECIMAL(18,2) NOT NULL,
    "attainmentPercentage" DECIMAL(7,2),
    "tierBreakdown" JSONB NOT NULL,
    "eligibilityStatus" BOOLEAN NOT NULL DEFAULT true,
    "blockedReason" TEXT,
    "payoutValue" DECIMAL(18,2) NOT NULL,
    "physicalPrizeDescription" TEXT,
    "approvalStatus" "BenefitApprovalStatus" NOT NULL DEFAULT 'APROVADO',

    CONSTRAINT "snapshot_periodo_financeiro_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "closure_audit_logs" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "referenceMonth" DATE NOT NULL,
    "userId" TEXT,
    "action" "ClosureAction" NOT NULL,
    "totalsBefore" JSONB,
    "totalsAfter" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "closure_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "platform_users_email_key" ON "platform_users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_memberId_key" ON "users"("memberId");

-- CreateIndex
CREATE INDEX "users_companyId_idx" ON "users"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "users_companyId_email_key" ON "users"("companyId", "email");

-- CreateIndex
CREATE INDEX "user_scope_assignments_companyId_idx" ON "user_scope_assignments"("companyId");

-- CreateIndex
CREATE INDEX "user_scope_assignments_userId_idx" ON "user_scope_assignments"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "user_scope_assignments_userId_scopeType_scopeId_key" ON "user_scope_assignments"("userId", "scopeType", "scopeId");

-- CreateIndex
CREATE UNIQUE INDEX "invites_memberId_key" ON "invites"("memberId");

-- CreateIndex
CREATE UNIQUE INDEX "invites_token_key" ON "invites"("token");

-- CreateIndex
CREATE INDEX "invites_companyId_idx" ON "invites"("companyId");

-- CreateIndex
CREATE INDEX "channels_companyId_idx" ON "channels"("companyId");

-- CreateIndex
CREATE INDEX "departments_companyId_idx" ON "departments"("companyId");

-- CreateIndex
CREATE INDEX "departments_channelId_idx" ON "departments"("channelId");

-- CreateIndex
CREATE INDEX "teams_companyId_idx" ON "teams"("companyId");

-- CreateIndex
CREATE INDEX "teams_departmentId_idx" ON "teams"("departmentId");

-- CreateIndex
CREATE INDEX "members_companyId_idx" ON "members"("companyId");

-- CreateIndex
CREATE INDEX "members_teamId_idx" ON "members"("teamId");

-- CreateIndex
CREATE INDEX "node_responsibles_companyId_idx" ON "node_responsibles"("companyId");

-- CreateIndex
CREATE INDEX "cargos_companyId_idx" ON "cargos"("companyId");

-- CreateIndex
CREATE INDEX "result_types_companyId_idx" ON "result_types"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "result_types_companyId_name_key" ON "result_types"("companyId", "name");

-- CreateIndex
CREATE INDEX "result_entries_companyId_idx" ON "result_entries"("companyId");

-- CreateIndex
CREATE INDEX "result_entries_memberId_date_idx" ON "result_entries"("memberId", "date");

-- CreateIndex
CREATE INDEX "result_entries_typeId_idx" ON "result_entries"("typeId");

-- CreateIndex
CREATE INDEX "operational_adjustments_companyId_idx" ON "operational_adjustments"("companyId");

-- CreateIndex
CREATE INDEX "operational_adjustments_memberId_dateReference_idx" ON "operational_adjustments"("memberId", "dateReference");

-- CreateIndex
CREATE INDEX "import_mappings_companyId_idx" ON "import_mappings"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "import_mappings_companyId_sourceLabel_key" ON "import_mappings"("companyId", "sourceLabel");

-- CreateIndex
CREATE INDEX "commercial_periods_companyId_idx" ON "commercial_periods"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "commercial_periods_companyId_referenceMonth_key" ON "commercial_periods"("companyId", "referenceMonth");

-- CreateIndex
CREATE INDEX "seasonality_bases_companyId_idx" ON "seasonality_bases"("companyId");

-- CreateIndex
CREATE INDEX "seasonality_weights_companyId_idx" ON "seasonality_weights"("companyId");

-- CreateIndex
CREATE INDEX "seasonality_weights_seasonalityBaseId_idx" ON "seasonality_weights"("seasonalityBaseId");

-- CreateIndex
CREATE INDEX "goal_campaigns_companyId_idx" ON "goal_campaigns"("companyId");

-- CreateIndex
CREATE INDEX "goal_triggers_companyId_idx" ON "goal_triggers"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "goal_triggers_goalCampaignId_order_key" ON "goal_triggers"("goalCampaignId", "order");

-- CreateIndex
CREATE INDEX "goal_lines_goalCampaignId_entityType_entityId_idx" ON "goal_lines"("goalCampaignId", "entityType", "entityId");

-- CreateIndex
CREATE INDEX "goal_lines_companyId_idx" ON "goal_lines"("companyId");

-- CreateIndex
CREATE INDEX "goal_lines_companyId_channelId_idx" ON "goal_lines"("companyId", "channelId");

-- CreateIndex
CREATE INDEX "goal_lines_companyId_departmentId_idx" ON "goal_lines"("companyId", "departmentId");

-- CreateIndex
CREATE INDEX "goal_lines_companyId_teamId_idx" ON "goal_lines"("companyId", "teamId");

-- CreateIndex
CREATE INDEX "goal_lines_companyId_memberId_idx" ON "goal_lines"("companyId", "memberId");

-- CreateIndex
CREATE INDEX "goal_line_group_sources_companyId_idx" ON "goal_line_group_sources"("companyId");

-- CreateIndex
CREATE INDEX "goal_line_group_sources_companyId_sourceGoalCampaignId_sour_idx" ON "goal_line_group_sources"("companyId", "sourceGoalCampaignId", "sourceEntityType", "sourceEntityId");

-- CreateIndex
CREATE UNIQUE INDEX "goal_line_group_sources_goalLineId_sourceGoalCampaignId_sou_key" ON "goal_line_group_sources"("goalLineId", "sourceGoalCampaignId", "sourceEntityType", "sourceEntityId");

-- CreateIndex
CREATE INDEX "goal_daily_values_companyId_idx" ON "goal_daily_values"("companyId");

-- CreateIndex
CREATE INDEX "goal_daily_values_memberId_date_idx" ON "goal_daily_values"("memberId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "goal_daily_values_goalLineId_date_key" ON "goal_daily_values"("goalLineId", "date");

-- CreateIndex
CREATE INDEX "receivables_bases_companyId_idx" ON "receivables_bases"("companyId");

-- CreateIndex
CREATE INDEX "receivables_value_tiers_companyId_idx" ON "receivables_value_tiers"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "receivables_value_tiers_receivablesBaseId_order_key" ON "receivables_value_tiers"("receivablesBaseId", "order");

-- CreateIndex
CREATE INDEX "receivables_beneficiaries_companyId_idx" ON "receivables_beneficiaries"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "receivables_beneficiaries_receivablesBaseId_memberId_key" ON "receivables_beneficiaries"("receivablesBaseId", "memberId");

-- CreateIndex
CREATE INDEX "receivables_conditional_triggers_companyId_idx" ON "receivables_conditional_triggers"("companyId");

-- CreateIndex
CREATE INDEX "receivables_tier_rules_companyId_idx" ON "receivables_tier_rules"("companyId");

-- CreateIndex
CREATE INDEX "receivables_tier_rules_receivablesBaseId_idx" ON "receivables_tier_rules"("receivablesBaseId");

-- CreateIndex
CREATE INDEX "member_closings_companyId_idx" ON "member_closings"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "member_closings_memberId_referenceMonth_key" ON "member_closings"("memberId", "referenceMonth");

-- CreateIndex
CREATE INDEX "snapshot_periodo_financeiro_companyId_idx" ON "snapshot_periodo_financeiro"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "snapshot_periodo_financeiro_memberClosingId_receivablesBase_key" ON "snapshot_periodo_financeiro"("memberClosingId", "receivablesBaseId", "periodStart");

-- CreateIndex
CREATE INDEX "closure_audit_logs_companyId_idx" ON "closure_audit_logs"("companyId");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "members"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_scope_assignments" ADD CONSTRAINT "user_scope_assignments_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_scope_assignments" ADD CONSTRAINT "user_scope_assignments_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invites" ADD CONSTRAINT "invites_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invites" ADD CONSTRAINT "invites_cargoId_fkey" FOREIGN KEY ("cargoId") REFERENCES "cargos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invites" ADD CONSTRAINT "invites_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invites" ADD CONSTRAINT "invites_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "members"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invites" ADD CONSTRAINT "invites_invitedByUserId_fkey" FOREIGN KEY ("invitedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channels" ADD CONSTRAINT "channels_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "departments" ADD CONSTRAINT "departments_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "departments" ADD CONSTRAINT "departments_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "channels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teams" ADD CONSTRAINT "teams_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teams" ADD CONSTRAINT "teams_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "members" ADD CONSTRAINT "members_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "members" ADD CONSTRAINT "members_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "members" ADD CONSTRAINT "members_cargoId_fkey" FOREIGN KEY ("cargoId") REFERENCES "cargos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "node_responsibles" ADD CONSTRAINT "node_responsibles_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "node_responsibles" ADD CONSTRAINT "node_responsibles_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "channels"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "node_responsibles" ADD CONSTRAINT "node_responsibles_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "node_responsibles" ADD CONSTRAINT "node_responsibles_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "node_responsibles" ADD CONSTRAINT "node_responsibles_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cargos" ADD CONSTRAINT "cargos_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "result_types" ADD CONSTRAINT "result_types_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "result_entries" ADD CONSTRAINT "result_entries_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "result_entries" ADD CONSTRAINT "result_entries_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "result_entries" ADD CONSTRAINT "result_entries_typeId_fkey" FOREIGN KEY ("typeId") REFERENCES "result_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operational_adjustments" ADD CONSTRAINT "operational_adjustments_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operational_adjustments" ADD CONSTRAINT "operational_adjustments_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operational_adjustments" ADD CONSTRAINT "operational_adjustments_typeId_fkey" FOREIGN KEY ("typeId") REFERENCES "result_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operational_adjustments" ADD CONSTRAINT "operational_adjustments_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_mappings" ADD CONSTRAINT "import_mappings_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_mappings" ADD CONSTRAINT "import_mappings_typeId_fkey" FOREIGN KEY ("typeId") REFERENCES "result_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commercial_periods" ADD CONSTRAINT "commercial_periods_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commercial_periods" ADD CONSTRAINT "commercial_periods_closedByUserId_fkey" FOREIGN KEY ("closedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commercial_periods" ADD CONSTRAINT "commercial_periods_reopenedByUserId_fkey" FOREIGN KEY ("reopenedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seasonality_bases" ADD CONSTRAINT "seasonality_bases_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seasonality_bases" ADD CONSTRAINT "seasonality_bases_resultTypeId_fkey" FOREIGN KEY ("resultTypeId") REFERENCES "result_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seasonality_weights" ADD CONSTRAINT "seasonality_weights_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seasonality_weights" ADD CONSTRAINT "seasonality_weights_seasonalityBaseId_fkey" FOREIGN KEY ("seasonalityBaseId") REFERENCES "seasonality_bases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goal_campaigns" ADD CONSTRAINT "goal_campaigns_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goal_campaigns" ADD CONSTRAINT "goal_campaigns_resultTypeId_fkey" FOREIGN KEY ("resultTypeId") REFERENCES "result_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goal_campaigns" ADD CONSTRAINT "goal_campaigns_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goal_triggers" ADD CONSTRAINT "goal_triggers_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goal_triggers" ADD CONSTRAINT "goal_triggers_goalCampaignId_fkey" FOREIGN KEY ("goalCampaignId") REFERENCES "goal_campaigns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goal_lines" ADD CONSTRAINT "goal_lines_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goal_lines" ADD CONSTRAINT "goal_lines_goalCampaignId_fkey" FOREIGN KEY ("goalCampaignId") REFERENCES "goal_campaigns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goal_lines" ADD CONSTRAINT "goal_lines_seasonalityBaseId_fkey" FOREIGN KEY ("seasonalityBaseId") REFERENCES "seasonality_bases"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goal_lines" ADD CONSTRAINT "goal_lines_dailySeasonalityBaseId_fkey" FOREIGN KEY ("dailySeasonalityBaseId") REFERENCES "seasonality_bases"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goal_lines" ADD CONSTRAINT "goal_lines_recalculatedFromLineId_fkey" FOREIGN KEY ("recalculatedFromLineId") REFERENCES "goal_lines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goal_line_group_sources" ADD CONSTRAINT "goal_line_group_sources_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goal_line_group_sources" ADD CONSTRAINT "goal_line_group_sources_goalLineId_fkey" FOREIGN KEY ("goalLineId") REFERENCES "goal_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goal_daily_values" ADD CONSTRAINT "goal_daily_values_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goal_daily_values" ADD CONSTRAINT "goal_daily_values_goalLineId_fkey" FOREIGN KEY ("goalLineId") REFERENCES "goal_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goal_daily_values" ADD CONSTRAINT "goal_daily_values_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "members"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receivables_bases" ADD CONSTRAINT "receivables_bases_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receivables_bases" ADD CONSTRAINT "receivables_bases_primaryGoalCampaignId_fkey" FOREIGN KEY ("primaryGoalCampaignId") REFERENCES "goal_campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receivables_bases" ADD CONSTRAINT "receivables_bases_resultTypeId_fkey" FOREIGN KEY ("resultTypeId") REFERENCES "result_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receivables_bases" ADD CONSTRAINT "receivables_bases_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receivables_value_tiers" ADD CONSTRAINT "receivables_value_tiers_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receivables_value_tiers" ADD CONSTRAINT "receivables_value_tiers_receivablesBaseId_fkey" FOREIGN KEY ("receivablesBaseId") REFERENCES "receivables_bases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receivables_beneficiaries" ADD CONSTRAINT "receivables_beneficiaries_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receivables_beneficiaries" ADD CONSTRAINT "receivables_beneficiaries_receivablesBaseId_fkey" FOREIGN KEY ("receivablesBaseId") REFERENCES "receivables_bases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receivables_beneficiaries" ADD CONSTRAINT "receivables_beneficiaries_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receivables_conditional_triggers" ADD CONSTRAINT "receivables_conditional_triggers_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receivables_conditional_triggers" ADD CONSTRAINT "receivables_conditional_triggers_receivablesBaseId_fkey" FOREIGN KEY ("receivablesBaseId") REFERENCES "receivables_bases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receivables_conditional_triggers" ADD CONSTRAINT "receivables_conditional_triggers_conditionalGoalCampaignId_fkey" FOREIGN KEY ("conditionalGoalCampaignId") REFERENCES "goal_campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receivables_conditional_triggers" ADD CONSTRAINT "receivables_conditional_triggers_resultTypeId_fkey" FOREIGN KEY ("resultTypeId") REFERENCES "result_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receivables_tier_rules" ADD CONSTRAINT "receivables_tier_rules_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receivables_tier_rules" ADD CONSTRAINT "receivables_tier_rules_receivablesBaseId_fkey" FOREIGN KEY ("receivablesBaseId") REFERENCES "receivables_bases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receivables_tier_rules" ADD CONSTRAINT "receivables_tier_rules_valueTierId_fkey" FOREIGN KEY ("valueTierId") REFERENCES "receivables_value_tiers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receivables_tier_rules" ADD CONSTRAINT "receivables_tier_rules_rewardResultTypeId_fkey" FOREIGN KEY ("rewardResultTypeId") REFERENCES "result_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_closings" ADD CONSTRAINT "member_closings_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_closings" ADD CONSTRAINT "member_closings_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_closings" ADD CONSTRAINT "member_closings_cargoId_fkey" FOREIGN KEY ("cargoId") REFERENCES "cargos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_closings" ADD CONSTRAINT "member_closings_closedByUserId_fkey" FOREIGN KEY ("closedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "snapshot_periodo_financeiro" ADD CONSTRAINT "snapshot_periodo_financeiro_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "snapshot_periodo_financeiro" ADD CONSTRAINT "snapshot_periodo_financeiro_memberClosingId_fkey" FOREIGN KEY ("memberClosingId") REFERENCES "member_closings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "snapshot_periodo_financeiro" ADD CONSTRAINT "snapshot_periodo_financeiro_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "snapshot_periodo_financeiro" ADD CONSTRAINT "snapshot_periodo_financeiro_receivablesBaseId_fkey" FOREIGN KEY ("receivablesBaseId") REFERENCES "receivables_bases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "closure_audit_logs" ADD CONSTRAINT "closure_audit_logs_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "closure_audit_logs" ADD CONSTRAINT "closure_audit_logs_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "closure_audit_logs" ADD CONSTRAINT "closure_audit_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
