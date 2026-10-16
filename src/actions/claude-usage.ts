import {
  action,
  type DialAction,
  DialUpEvent,
  DidReceiveSettingsEvent,
  TouchTapEvent,
  WillAppearEvent,
  streamDeck,
} from "@elgato/streamdeck";
import { ClaudeOauthUsageProvider } from "../providers/claude/claude-oauth-usage-provider.js";
import { CLAUDE_COORDINATOR_OPTIONS } from "../providers/claude/claude-coordinator-options.js";
import { RefreshingAction, type RefreshSettings } from "../refreshing-action.js";
import { UsageProviderCoordinator } from "../usage/provider-coordinator.js";
import type { CoordinatedUsageResult } from "../usage/provider-coordinator.js";
import { renderClaudeFeedback } from "./usage-feedback.js";

@action({ UUID: "com.refactor-ia.nan.claude" })
export class ClaudeUsage extends RefreshingAction {
  private readonly coordinator: UsageProviderCoordinator;
  private lastResult: CoordinatedUsageResult | null = null;

  constructor(
    coordinator = new UsageProviderCoordinator(
      new ClaudeOauthUsageProvider(),
      CLAUDE_COORDINATOR_OPTIONS,
    ),
  ) {
    super();
    this.coordinator = coordinator;
  }

  override async onWillAppear(ev: WillAppearEvent<RefreshSettings>): Promise<void> {
    const action = ev.action;
    if (!action.isDial()) return;
    await this.activateOnAppearance(
      action,
      ev.payload.settings,
      () => action.setFeedbackLayout("layouts/claude.json"),
    );
  }

  override async onTouchTap(ev: TouchTapEvent<RefreshSettings>): Promise<void> {
    await this.refresh(ev.action, true);
  }

  override async onDialUp(_ev: DialUpEvent<RefreshSettings>): Promise<void> {
    await streamDeck.system.openUrl("https://claude.ai/settings/usage");
  }

  override async onDidReceiveSettings(
    ev: DidReceiveSettingsEvent<RefreshSettings>,
  ): Promise<void> {
    if (!ev.action.isDial()) return;
    this.configureRefresh(ev.action, ev.payload.settings);
    await this.refresh(ev.action);
  }

  protected override async updateDisplay(
    action: Parameters<RefreshingAction["refresh"]>[0],
    isCurrent: () => boolean,
    force: boolean,
  ): Promise<void> {
    this.lastResult = await this.coordinator.getUsage({ force });
    const feedback = renderClaudeFeedback(this.lastResult, false);
    if (isCurrent()) await action.setFeedback(feedback);
  }

  protected override async onAlternationTick(
    action: DialAction<RefreshSettings>,
    showCountdown: boolean,
  ): Promise<void> {
    if (!this.lastResult) return;
    const feedback = renderClaudeFeedback(this.lastResult, showCountdown);
    const isCurrent = this.lifecycleGuard(action);
    if (isCurrent()) await action.setFeedback(feedback);
  }
}
