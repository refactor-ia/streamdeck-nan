import { streamDeck } from "@elgato/streamdeck";
import { ClaudeUsage } from "./actions/claude-usage.js";
import { CodexUsage } from "./actions/codex-usage.js";
import { GrokUsage } from "./actions/grok-usage.js";
import { NanDemoUsage } from "./actions/nan-demo-usage.js";
import { NanModelUsage } from "./actions/nan-model-usage.js";
import { NanTotalTokensUsage, NanMonthlyTokensUsage } from "./actions/nan-metrics-usage.js";
import { NanDashboardController } from "./actions/nan-dashboard-controller.js";
import { NanDashboardLauncher } from "./actions/nan-dashboard-launcher.js";
import { ClaudeOauthUsageProvider } from "./providers/claude/claude-oauth-usage-provider.js";
import { CLAUDE_COORDINATOR_OPTIONS } from "./providers/claude/claude-coordinator-options.js";
import { CodexUsageProvider } from "./providers/codex/codex-usage-provider.js";
import { GrokUsageProvider } from "./providers/grok/grok-usage-provider.js";
import { installPluginShutdown } from "./plugin-shutdown.js";
import { UsageProviderCoordinator } from "./usage/provider-coordinator.js";
import { TransitioningProviderStatusReporter } from "./usage/provider-status-reporter.js";

const statusReporter = new TransitioningProviderStatusReporter((message) => streamDeck.logger.warn(message));

// The CLI -p /usage output no longer carries limit percentages; the OAuth provider
// reuses Claude Code's stored session (quorb-style). Old CLI provider kept for reference.
const claudeProvider = new ClaudeOauthUsageProvider();
const claudeCoordinator = new UsageProviderCoordinator(
  claudeProvider,
  { ...CLAUDE_COORDINATOR_OPTIONS, statusReporter },
);
const codexProvider = new CodexUsageProvider();
const codexCoordinator = new UsageProviderCoordinator(codexProvider, { statusReporter });
const grokProvider = new GrokUsageProvider();
const grokCoordinator = new UsageProviderCoordinator(grokProvider, { statusReporter });
const claudeAction = new ClaudeUsage(claudeCoordinator);
const codexAction = new CodexUsage(codexCoordinator);
const grokAction = new GrokUsage(grokCoordinator);
const nanDashboard = new NanDashboardController();
const nanAction = new NanDemoUsage(nanDashboard);
const nanModelAction = new NanModelUsage(nanDashboard);
const nanTotalTokensAction = new NanTotalTokensUsage(nanDashboard);
const nanMonthlyTokensAction = new NanMonthlyTokensUsage(nanDashboard);
const nanDashboardLauncher = new NanDashboardLauncher();

streamDeck.actions.registerAction(claudeAction);
streamDeck.actions.registerAction(codexAction);
streamDeck.actions.registerAction(grokAction);
streamDeck.actions.registerAction(nanAction);
streamDeck.actions.registerAction(nanModelAction);
streamDeck.actions.registerAction(nanTotalTokensAction);
streamDeck.actions.registerAction(nanMonthlyTokensAction);
streamDeck.actions.registerAction(nanDashboardLauncher);

streamDeck.system.onSystemDidWakeUp(() => {
  claudeCoordinator.recoverAfterWake();
  codexCoordinator.recoverAfterWake();
  grokCoordinator.recoverAfterWake();
  void Promise.all([
    claudeAction.resumeAfterSystemWake(),
    codexAction.resumeAfterSystemWake(),
    grokAction.resumeAfterSystemWake(),
    nanAction.resumeAfterSystemWake(),
  ]);
});

installPluginShutdown([claudeProvider, codexProvider, grokProvider]);

streamDeck.connect();
