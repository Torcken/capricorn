/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Box, Text } from 'ink';
import { LoopDetectionConfirmation } from './LoopDetectionConfirmation.js';
import { FolderTrustDialog } from './FolderTrustDialog.js';
import { ConsentPrompt } from './ConsentPrompt.js';
import { ThemeDialog } from './ThemeDialog.js';
import { SettingsDialog } from './SettingsDialog.js';
import { AuthInProgress } from '../auth/AuthInProgress.js';
import { InferenceSetupDialog } from '../auth/InferenceSetupDialog.js';
import { AuthState } from '../types.js';
import { EditorSettingsDialog } from './EditorSettingsDialog.js';
import { relaunchApp } from '../../utils/processUtils.js';
import { SessionBrowser } from './SessionBrowser.js';
import { PermissionsModifyTrustDialog } from './PermissionsModifyTrustDialog.js';
import { CapricornModelDialog } from './CapricornModelDialog.js';
import { VoiceModelDialog } from './VoiceModelDialog.js';
import { theme } from '../semantic-colors.js';
import { useUIState } from '../contexts/UIStateContext.js';
import { useUIActions } from '../contexts/UIActionsContext.js';
import { useConfig } from '../contexts/ConfigContext.js';
import { useSettings } from '../contexts/SettingsContext.js';
import process from 'node:process';
import { type UseHistoryManagerReturn } from '../hooks/useHistoryManager.js';
import { AdminSettingsChangedDialog } from './AdminSettingsChangedDialog.js';
import { NewAgentsNotification } from './NewAgentsNotification.js';
import { AgentConfigDialog } from './AgentConfigDialog.js';
import { PolicyUpdateDialog } from './PolicyUpdateDialog.js';

interface DialogManagerProps {
  addItem: UseHistoryManagerReturn['addItem'];
  terminalWidth: number;
}

// Capricorn: the Google quota, AI-credit, account-validation, suspended-account,
// API-key, sign-in restart and privacy-notice dialogs were removed; none can
// be reached with local Ollama inference.

// Props for DialogManager
export const DialogManager = ({
  addItem,
  terminalWidth,
}: DialogManagerProps) => {
  const config = useConfig();
  const settings = useSettings();

  const uiState = useUIState();
  const uiActions = useUIActions();
  const {
    constrainHeight,
    terminalHeight,
    staticExtraHeight,
    terminalWidth: uiTerminalWidth,
  } = uiState;

  if (uiState.adminSettingsChanged) {
    return <AdminSettingsChangedDialog />;
  }
  if (uiState.newAgents) {
    return (
      <NewAgentsNotification
        agents={uiState.newAgents}
        onSelect={uiActions.handleNewAgentsSelect}
      />
    );
  }
  if (uiState.isFolderTrustDialogOpen) {
    return (
      <FolderTrustDialog
        onSelect={uiActions.handleFolderTrustSelect}
        isRestarting={uiState.isRestarting}
        discoveryResults={uiState.folderDiscoveryResults}
      />
    );
  }
  if (uiState.isPolicyUpdateDialogOpen) {
    return (
      <PolicyUpdateDialog
        config={config}
        request={uiState.policyUpdateConfirmationRequest!}
        onClose={() => uiActions.setIsPolicyUpdateDialogOpen(false)}
      />
    );
  }
  if (uiState.loopDetectionConfirmationRequest) {
    return (
      <LoopDetectionConfirmation
        onComplete={uiState.loopDetectionConfirmationRequest.onComplete}
      />
    );
  }

  if (uiState.permissionConfirmationRequest) {
    const files = uiState.permissionConfirmationRequest.files;
    const filesList = files.map((f) => `- ${f}`).join('\n');
    return (
      <ConsentPrompt
        prompt={`The following files are outside your workspace:\n\n${filesList}\n\nDo you want to allow this read?`}
        onConfirm={(allowed) => {
          uiState.permissionConfirmationRequest?.onComplete({ allowed });
        }}
        terminalWidth={terminalWidth}
      />
    );
  }

  // commandConfirmationRequest and authConsentRequest are kept separate
  // to avoid focus deadlocks and state race conditions between the
  // synchronous command loop and the asynchronous auth flow.
  if (uiState.commandConfirmationRequest) {
    return (
      <ConsentPrompt
        prompt={uiState.commandConfirmationRequest.prompt}
        onConfirm={uiState.commandConfirmationRequest.onConfirm}
        terminalWidth={terminalWidth}
      />
    );
  }
  if (uiState.authConsentRequest) {
    return (
      <ConsentPrompt
        prompt={uiState.authConsentRequest.prompt}
        onConfirm={uiState.authConsentRequest.onConfirm}
        terminalWidth={terminalWidth}
      />
    );
  }
  if (uiState.confirmUpdateExtensionRequests.length > 0) {
    const request = uiState.confirmUpdateExtensionRequests[0];
    return (
      <ConsentPrompt
        prompt={request.prompt}
        onConfirm={request.onConfirm}
        terminalWidth={terminalWidth}
      />
    );
  }
  if (uiState.isThemeDialogOpen) {
    return (
      <Box flexDirection="column">
        {uiState.themeError && (
          <Box marginBottom={1}>
            <Text color={theme.status.error}>{uiState.themeError}</Text>
          </Box>
        )}
        <ThemeDialog
          onSelect={uiActions.handleThemeSelect}
          onCancel={uiActions.closeThemeDialog}
          onHighlight={uiActions.handleThemeHighlight}
          settings={settings}
          availableTerminalHeight={
            constrainHeight ? terminalHeight - staticExtraHeight : undefined
          }
          terminalWidth={uiTerminalWidth}
        />
      </Box>
    );
  }
  if (uiState.isSettingsDialogOpen) {
    return (
      <Box flexDirection="column">
        <SettingsDialog
          onSelect={() => uiActions.closeSettingsDialog()}
          onRestartRequest={relaunchApp}
          availableTerminalHeight={terminalHeight - staticExtraHeight}
        />
      </Box>
    );
  }
  if (uiState.isModelDialogOpen) {
    // Capricorn: Gemma 4 picker instead of the upstream Gemini model dialog.
    return <CapricornModelDialog onClose={uiActions.closeModelDialog} />;
  }
  if (uiState.isVoiceModelDialogOpen) {
    return <VoiceModelDialog onClose={uiActions.closeVoiceModelDialog} />;
  }
  if (
    uiState.isAgentConfigDialogOpen &&
    uiState.selectedAgentName &&
    uiState.selectedAgentDisplayName &&
    uiState.selectedAgentDefinition
  ) {
    return (
      <Box flexDirection="column">
        <AgentConfigDialog
          agentName={uiState.selectedAgentName}
          displayName={uiState.selectedAgentDisplayName}
          definition={uiState.selectedAgentDefinition}
          settings={settings}
          availableTerminalHeight={terminalHeight - staticExtraHeight}
          onClose={uiActions.closeAgentConfigDialog}
          onSave={async () => {
            // Reload agent registry to pick up changes
            const agentRegistry = config?.getAgentRegistry();
            if (agentRegistry) {
              await agentRegistry.reload();
            }
          }}
        />
      </Box>
    );
  }
  if (uiState.isAuthenticating) {
    return (
      <AuthInProgress
        onTimeout={() => {
          uiActions.onAuthError('Authentication cancelled.');
        }}
      />
    );
  }
  if (uiState.isAuthDialogOpen) {
    // Capricorn: no provider/sign-in choice exists; explain the local
    // inference failure and offer retry or exit instead of AuthDialog.
    return (
      <Box flexDirection="column">
        <InferenceSetupDialog
          error={uiState.authError}
          onRetry={() => uiActions.setAuthState(AuthState.Unauthenticated)}
          onExit={() => {
            process.exit(1);
          }}
        />
      </Box>
    );
  }
  if (uiState.isEditorDialogOpen) {
    return (
      <Box flexDirection="column">
        {uiState.editorError && (
          <Box marginBottom={1}>
            <Text color={theme.status.error}>{uiState.editorError}</Text>
          </Box>
        )}
        <EditorSettingsDialog
          onSelect={uiActions.handleEditorSelect}
          settings={settings}
          onExit={uiActions.exitEditorDialog}
        />
      </Box>
    );
  }
  if (uiState.isSessionBrowserOpen) {
    return (
      <SessionBrowser
        config={config}
        onResumeSession={uiActions.handleResumeSession}
        onDeleteSession={uiActions.handleDeleteSession}
        onExit={uiActions.closeSessionBrowser}
      />
    );
  }

  if (uiState.isPermissionsDialogOpen) {
    return (
      <PermissionsModifyTrustDialog
        onExit={uiActions.closePermissionsDialog}
        addItem={addItem}
        targetDirectory={uiState.permissionsDialogProps?.targetDirectory}
      />
    );
  }

  return null;
};
