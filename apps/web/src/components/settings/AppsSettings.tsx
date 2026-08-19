/**
 * Settings › Apps — external services (Gmail, GitHub, Linear, …) the server
 * attaches to provider sessions as remote MCP servers. The server owns every
 * record and credential, so this panel only reads `settings.apps` and drives
 * the `apps.*` RPCs: connect (OAuth), paste a token, test the handshake, edit
 * or remove a connection, and register the bring-your-own OAuth clients that
 * families without dynamic registration require.
 */
import { useCallback, useMemo, useState, type ReactNode } from "react";
import {
  AppConnectionId,
  findAppCatalogEntry,
  findAppOAuthClientFamily,
  APP_OAUTH_CLIENT_FAMILIES,
  type AppAuthKind,
  type AppCatalogEntry,
  type AppCategory,
  type AppConnection,
  type AppConnectionInput,
  type AppOAuthClientFamily,
  type AppsSettings,
  type AppsTestResult,
} from "@t3tools/contracts";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import {
  ChevronDownIcon,
  CopyIcon,
  EllipsisIcon,
  ExternalLinkIcon,
  KeyRoundIcon,
  LayoutGridIcon,
  PlugIcon,
  PlusIcon,
  SearchIcon,
  StoreIcon,
} from "lucide-react";

import { writeTextToClipboard } from "~/hooks/useCopyToClipboard";
import { usePrimarySettings } from "~/hooks/useSettings";
import { cn, randomUUID } from "~/lib/utils";
import { ensureLocalApi } from "~/localApi";
import { useEnvironmentHttpBaseUrl, usePrimaryEnvironmentId } from "~/state/environments";
import { serverEnvironment } from "~/state/server";
import { useAtomCommand } from "~/state/use-atom-command";
import { AppIcon, appPresentation } from "../apps/AppIcon";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { DraftInput } from "../ui/draft-input";
import { Empty, EmptyDescription, EmptyMedia, EmptyTitle } from "../ui/empty";
import { Input } from "../ui/input";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { Spinner } from "../ui/spinner";
import { Switch } from "../ui/switch";
import { toastManager } from "../ui/toast";
import {
  APP_CATEGORY_FILTERS,
  APP_STATUS_LABELS,
  appAuthHint,
  appConnectionInput,
  appConnectionStatus,
  appDraftError,
  appOAuthClientFamilyId,
  appsRedirectUri,
  catalogConnectionInput,
  connectedCatalogIds,
  deriveAppSlug,
  filterAppCatalog,
  sortedAppConnections,
  type AppConnectionDraft,
  type AppConnectionStatus,
} from "./AppsSettings.logic";
import { ITEM_ROW_CLASSNAME, ITEM_ROW_INNER_CLASSNAME } from "./itemRows";
import { SettingsPageContainer, SettingsSection } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";

const STATUS_BADGE_VARIANT: Readonly<
  Record<AppConnectionStatus, "success" | "warning" | "outline">
> = {
  connected: "success",
  "needs-oauth-client": "warning",
  disconnected: "outline",
};

/** Readable message for a failed RPC; `null` when it was merely interrupted. */
function commandFailureMessage<A, E>(result: AtomCommandResult<A, E>): string | null {
  if (result._tag !== "Failure" || isAtomCommandInterrupted(result)) return null;
  const error = squashAtomCommandFailure(result);
  return error instanceof Error ? error.message : "Something went wrong.";
}

function toastCommandFailure<A, E>(result: AtomCommandResult<A, E>, title: string): void {
  const description = commandFailureMessage(result);
  if (description === null) return;
  toastManager.add({ type: "error", title, description });
}

function openExternalUrl(url: string): void {
  void ensureLocalApi()
    .shell.openExternal(url)
    .catch(() => {
      toastManager.add({ type: "error", title: "Could not open the link", description: url });
    });
}

/** Which dialog, if any, is open. Records are looked up live by id. */
type AppsDialog =
  | { readonly kind: "create" }
  | { readonly kind: "edit"; readonly connectionId: AppConnectionId }
  | { readonly kind: "token"; readonly connectionId: AppConnectionId }
  | { readonly kind: "remove"; readonly connectionId: AppConnectionId }
  | { readonly kind: "disconnect"; readonly connectionId: AppConnectionId }
  | { readonly kind: "test"; readonly connectionId: AppConnectionId }
  | {
      readonly kind: "oauth-client";
      readonly familyId: string;
      /** Connection to authorize once the client is saved. */
      readonly connectAfter: AppConnectionId | null;
    };

export function AppsSettingsPanel() {
  const environmentId = usePrimaryEnvironmentId();
  const httpBaseUrl = useEnvironmentHttpBaseUrl(environmentId);
  const apps = usePrimarySettings((settings) => settings.apps);
  const connections = useMemo(() => sortedAppConnections(apps.connections), [apps.connections]);
  const callbackOrigin = useMemo(() => {
    if (httpBaseUrl === null) return null;
    try {
      return new URL(httpBaseUrl).origin;
    } catch {
      return null;
    }
  }, [httpBaseUrl]);

  const upsertApp = useAtomCommand(serverEnvironment.appsUpsert, { reportFailure: false });
  const removeApp = useAtomCommand(serverEnvironment.appsRemove, { reportFailure: false });
  const authorizeApp = useAtomCommand(serverEnvironment.appsAuthorize, { reportFailure: false });
  const setAppToken = useAtomCommand(serverEnvironment.appsSetToken, { reportFailure: false });
  const setOAuthClient = useAtomCommand(serverEnvironment.appsSetOAuthClient, {
    reportFailure: false,
  });
  const disconnectApp = useAtomCommand(serverEnvironment.appsDisconnect, { reportFailure: false });
  const testApp = useAtomCommand(serverEnvironment.appsTest, { reportFailure: false });

  const [dialog, setDialog] = useState<AppsDialog | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [test, setTest] = useState<{
    readonly result: AppsTestResult | null;
    readonly error: string | null;
  }>({ result: null, error: null });
  // Popup blockers can swallow the authorization tab, so the row offers the
  // link as a plain anchor until the credential lands.
  const [authorizationLink, setAuthorizationLink] = useState<{
    readonly connectionId: AppConnectionId;
    readonly url: string;
  } | null>(null);

  const closeDialog = useCallback(() => setDialog(null), []);

  const saveConnection = useCallback(
    async (input: AppConnectionInput, failureTitle: string) => {
      if (environmentId === null) return false;
      setPendingId(input.id);
      const result = await upsertApp({ environmentId, input: { connection: input } });
      setPendingId(null);
      if (result._tag === "Failure") {
        toastCommandFailure(result, failureTitle);
        return false;
      }
      return true;
    },
    [environmentId, upsertApp],
  );

  const authorize = useCallback(
    async (connectionId: AppConnectionId, name: string) => {
      if (environmentId === null) return;
      if (callbackOrigin === null) {
        toastManager.add({
          type: "error",
          title: "No connection to this environment",
          description: "Reconnect before authorizing an app.",
        });
        return;
      }
      setPendingId(connectionId);
      const result = await authorizeApp({
        environmentId,
        input: { connectionId, callbackOrigin },
      });
      setPendingId(null);
      if (result._tag === "Failure") {
        toastCommandFailure(result, `Could not connect ${name}`);
        return;
      }
      setAuthorizationLink({ connectionId, url: result.value.authorizationUrl });
      openExternalUrl(result.value.authorizationUrl);
    },
    [authorizeApp, callbackOrigin, environmentId],
  );

  const handleToggle = useCallback(
    (connection: AppConnection, enabled: boolean) => {
      void saveConnection(
        { ...appConnectionInput(connection), enabled },
        `Could not ${enabled ? "enable" : "disable"} ${connection.name}`,
      );
    },
    [saveConnection],
  );

  const handleAddCatalogApp = useCallback(
    async (entry: AppCatalogEntry, auth: AppAuthKind) => {
      const takenSlugs = Object.values(apps.connections).map((connection) => connection.slug);
      const input = catalogConnectionInput(
        entry,
        takenSlugs,
        auth,
        AppConnectionId.make(randomUUID()),
      );
      if (!(await saveConnection(input, `Could not add ${entry.name}`))) return;
      if (auth === "token") {
        setDialog({ kind: "token", connectionId: input.id });
        return;
      }
      if (auth === "none") {
        toastManager.add({ type: "success", title: `${entry.name} added` });
        return;
      }
      const familyId = entry.oauthClientFamily ?? null;
      if (familyId !== null && apps.oauthClients[familyId] === undefined) {
        setDialog({ kind: "oauth-client", familyId, connectAfter: input.id });
        return;
      }
      await authorize(input.id, entry.name);
    },
    [apps.connections, apps.oauthClients, authorize, saveConnection],
  );

  const handleSetToken = useCallback(
    async (connection: AppConnection, token: string) => {
      if (environmentId === null) return;
      setPendingId(connection.id);
      const result = await setAppToken({
        environmentId,
        input: { connectionId: connection.id, token },
      });
      setPendingId(null);
      if (result._tag === "Failure") {
        toastCommandFailure(result, `Could not save the ${connection.name} token`);
        return;
      }
      closeDialog();
      toastManager.add({ type: "success", title: `${connection.name} connected` });
    },
    [closeDialog, environmentId, setAppToken],
  );

  const handleTest = useCallback(
    async (connection: AppConnection) => {
      if (environmentId === null) return;
      setDialog({ kind: "test", connectionId: connection.id });
      setTest({ result: null, error: null });
      const result = await testApp({
        environmentId,
        input: { connectionId: connection.id },
      });
      if (result._tag === "Failure") {
        setTest({
          result: null,
          error: commandFailureMessage(result) ?? "The test was cancelled.",
        });
        return;
      }
      setTest({ result: result.value, error: null });
    },
    [environmentId, testApp],
  );

  const handleDisconnect = useCallback(
    async (connection: AppConnection) => {
      if (environmentId === null) return;
      setPendingId(connection.id);
      const result = await disconnectApp({
        environmentId,
        input: { connectionId: connection.id },
      });
      setPendingId(null);
      closeDialog();
      if (result._tag === "Failure") {
        toastCommandFailure(result, `Could not disconnect ${connection.name}`);
      }
    },
    [closeDialog, disconnectApp, environmentId],
  );

  const handleRemove = useCallback(
    async (connection: AppConnection) => {
      if (environmentId === null) return;
      setPendingId(connection.id);
      const result = await removeApp({
        environmentId,
        input: { connectionId: connection.id },
      });
      setPendingId(null);
      closeDialog();
      if (result._tag === "Failure") {
        toastCommandFailure(result, `Could not remove ${connection.name}`);
      }
    },
    [closeDialog, environmentId, removeApp],
  );

  const handleSaveOAuthClient = useCallback(
    async (
      familyId: string,
      clientId: string,
      clientSecret: string | null,
      connectAfter: AppConnectionId | null,
    ) => {
      if (environmentId === null) return;
      setPendingId(familyId);
      const result = await setOAuthClient({
        environmentId,
        input: {
          family: familyId,
          clientId,
          ...(clientSecret === null ? {} : { clientSecret }),
        },
      });
      setPendingId(null);
      if (result._tag === "Failure") {
        toastCommandFailure(result, "Could not save the OAuth client");
        return;
      }
      closeDialog();
      if (clientId.length === 0) {
        toastManager.add({ type: "success", title: "OAuth client removed" });
        return;
      }
      if (connectAfter === null) {
        toastManager.add({ type: "success", title: "OAuth client saved" });
        return;
      }
      const connection = apps.connections[connectAfter];
      if (connection) await authorize(connection.id, connection.name);
    },
    [apps.connections, authorize, closeDialog, environmentId, setOAuthClient],
  );

  const dialogConnection =
    dialog !== null && "connectionId" in dialog ? apps.connections[dialog.connectionId] : undefined;
  const editingConnection = dialog?.kind === "edit" ? dialogConnection : undefined;
  const dialogFamily =
    dialog?.kind === "oauth-client" ? findAppOAuthClientFamily(dialog.familyId) : undefined;

  return (
    <SettingsPageContainer>
      <SettingsSection
        {...searchableSetting("apps-connected")}
        title="Connected apps"
        icon={<PlugIcon className="size-4.5 text-muted-foreground" />}
      >
        <p className="px-3 pb-2 text-[13px] leading-[1.45] text-muted-foreground/80 sm:px-4">
          Enabled apps that finished signing in reach every agent as{" "}
          <code className="font-mono text-xs">@slug</code> tools.
        </p>
        {environmentId === null ? (
          <AppsHint>Connect an environment to manage apps.</AppsHint>
        ) : connections.length === 0 ? (
          <Empty className="gap-2 py-8">
            <EmptyMedia variant="icon">
              <LayoutGridIcon />
            </EmptyMedia>
            <EmptyTitle className="text-base">No apps connected yet</EmptyTitle>
            <EmptyDescription>Pick one below.</EmptyDescription>
          </Empty>
        ) : (
          connections.map((connection) => (
            <AppConnectionRow
              key={connection.id}
              connection={connection}
              status={appConnectionStatus(connection, apps.oauthClients)}
              pending={pendingId === connection.id}
              authorizationUrl={
                authorizationLink?.connectionId === connection.id &&
                connection.authorizedAt === null
                  ? authorizationLink.url
                  : null
              }
              onToggle={(enabled) => handleToggle(connection, enabled)}
              onConnect={() => void authorize(connection.id, connection.name)}
              onSetToken={() => setDialog({ kind: "token", connectionId: connection.id })}
              onConfigureOAuthClient={(familyId) =>
                setDialog({ kind: "oauth-client", familyId, connectAfter: connection.id })
              }
              onTest={() => void handleTest(connection)}
              onEdit={() => setDialog({ kind: "edit", connectionId: connection.id })}
              onDisconnect={() => setDialog({ kind: "disconnect", connectionId: connection.id })}
              onRemove={() => setDialog({ kind: "remove", connectionId: connection.id })}
            />
          ))
        )}
      </SettingsSection>

      <BrowseAppsSection
        oauthClients={apps.oauthClients}
        addedCatalogIds={connectedCatalogIds(apps.connections)}
        disabled={environmentId === null}
        onAdd={(entry, auth) => void handleAddCatalogApp(entry, auth)}
        onAddCustom={() => setDialog({ kind: "create" })}
      />

      <OAuthClientsSection
        oauthClients={apps.oauthClients}
        disabled={environmentId === null}
        onConfigure={(familyId) =>
          setDialog({ kind: "oauth-client", familyId, connectAfter: null })
        }
      />

      {dialog?.kind === "create" || editingConnection !== undefined ? (
        <AppEditDialog
          connection={editingConnection ?? null}
          takenSlugs={
            new Set(
              Object.values(apps.connections)
                .filter((connection) => connection.id !== editingConnection?.id)
                .map((connection) => connection.slug),
            )
          }
          pending={pendingId !== null}
          onClose={closeDialog}
          onSave={async (input) => {
            const saved = await saveConnection(
              input,
              editingConnection === undefined ? "Could not add the app" : "Could not save the app",
            );
            if (saved) closeDialog();
          }}
        />
      ) : null}

      {dialog?.kind === "token" && dialogConnection !== undefined ? (
        <AppTokenDialog
          connection={dialogConnection}
          pending={pendingId === dialogConnection.id}
          onClose={closeDialog}
          onSubmit={(token) => void handleSetToken(dialogConnection, token)}
        />
      ) : null}

      {dialog?.kind === "test" && dialogConnection !== undefined ? (
        <AppTestDialog
          connection={dialogConnection}
          result={test.result}
          error={test.error}
          onClose={closeDialog}
        />
      ) : null}

      {dialog?.kind === "oauth-client" && dialogFamily !== undefined ? (
        <AppOAuthClientDialog
          family={dialogFamily}
          client={apps.oauthClients[dialogFamily.id]}
          redirectUri={callbackOrigin === null ? null : appsRedirectUri(callbackOrigin)}
          pending={pendingId === dialogFamily.id}
          onClose={closeDialog}
          onSave={(clientId, clientSecret) =>
            void handleSaveOAuthClient(
              dialogFamily.id,
              clientId,
              clientSecret,
              dialog.kind === "oauth-client" ? dialog.connectAfter : null,
            )
          }
        />
      ) : null}

      {dialog?.kind === "disconnect" && dialogConnection !== undefined ? (
        <AppConfirmDialog
          title={`Disconnect ${dialogConnection.name}?`}
          description="The stored credential is deleted. The app stays in your list so you can connect it again."
          confirmLabel="Disconnect"
          pending={pendingId === dialogConnection.id}
          onClose={closeDialog}
          onConfirm={() => void handleDisconnect(dialogConnection)}
        />
      ) : null}

      {dialog?.kind === "remove" && dialogConnection !== undefined ? (
        <AppConfirmDialog
          title={`Remove ${dialogConnection.name}?`}
          description="The connection and its credential are deleted, and its tools stop reaching agents."
          confirmLabel="Remove"
          pending={pendingId === dialogConnection.id}
          onClose={closeDialog}
          onConfirm={() => void handleRemove(dialogConnection)}
        />
      ) : null}
    </SettingsPageContainer>
  );
}

function AppsHint({ children, tone = "muted" }: { children: ReactNode; tone?: "muted" | "error" }) {
  return (
    <p
      className={cn(
        "px-3 py-2 text-[13px] sm:px-4",
        tone === "error" ? "text-destructive-foreground" : "text-muted-foreground",
      )}
    >
      {children}
    </p>
  );
}

function AppConnectionRow({
  connection,
  status,
  pending,
  authorizationUrl,
  onToggle,
  onConnect,
  onSetToken,
  onConfigureOAuthClient,
  onTest,
  onEdit,
  onDisconnect,
  onRemove,
}: {
  connection: AppConnection;
  status: AppConnectionStatus;
  pending: boolean;
  authorizationUrl: string | null;
  onToggle: (enabled: boolean) => void;
  onConnect: () => void;
  onSetToken: () => void;
  onConfigureOAuthClient: (familyId: string) => void;
  onTest: () => void;
  onEdit: () => void;
  onDisconnect: () => void;
  onRemove: () => void;
}) {
  const entry = findAppCatalogEntry(connection.catalogId);
  const presentation = appPresentation(connection);
  const familyId = appOAuthClientFamilyId(connection.catalogId);
  const isConnected = status === "connected";

  return (
    <div className={cn(ITEM_ROW_CLASSNAME, "hover:bg-accent/50")}>
      <div className={ITEM_ROW_INNER_CLASSNAME}>
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <AppIcon
            name={presentation.name}
            color={presentation.color}
            iconDomain={presentation.iconDomain}
            size={32}
          />
          <div className="min-w-0 flex-1 space-y-0.5">
            <div className="flex min-w-0 items-center gap-2">
              <h3 className="truncate text-sm font-medium tracking-[-0.005em] text-foreground">
                {connection.name}
              </h3>
              <span className="shrink-0 font-mono text-xs text-muted-foreground">
                @{connection.slug}
              </span>
              <Badge variant={STATUS_BADGE_VARIANT[status]} size="sm">
                {APP_STATUS_LABELS[status]}
              </Badge>
            </div>
            <p className="truncate text-[13px] leading-[1.45] text-muted-foreground/80">
              {entry?.description ?? connection.url}
            </p>
            {connection.lastError !== null ? (
              <p className="text-xs text-destructive-foreground">{connection.lastError}</p>
            ) : null}
            {authorizationUrl !== null ? (
              <p className="text-xs text-muted-foreground">
                Didn&rsquo;t open?{" "}
                <a
                  href={authorizationUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline underline-offset-2 hover:text-foreground"
                >
                  Open authorization page
                </a>
              </p>
            ) : null}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Switch
            checked={connection.enabled}
            disabled={pending}
            onCheckedChange={(checked) => onToggle(Boolean(checked))}
            aria-label={`Enable ${connection.name}`}
          />
          {!isConnected && connection.auth === "token" ? (
            <Button size="xs" variant="outline" disabled={pending} onClick={onSetToken}>
              Set token…
            </Button>
          ) : null}
          {!isConnected && connection.auth === "oauth" ? (
            status === "needs-oauth-client" && familyId !== null ? (
              <Button
                size="xs"
                variant="outline"
                disabled={pending}
                onClick={() => onConfigureOAuthClient(familyId)}
              >
                Set up…
              </Button>
            ) : (
              <Button size="xs" variant="outline" disabled={pending} onClick={onConnect}>
                {pending ? <Spinner className="size-3.5" /> : null}
                Connect
              </Button>
            )
          ) : null}
          <Menu>
            <MenuTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  disabled={pending}
                  aria-label={`Actions for ${connection.name}`}
                />
              }
            >
              <EllipsisIcon className="size-3.5" />
            </MenuTrigger>
            <MenuPopup align="end" className="min-w-40">
              <MenuItem onClick={onTest}>Test</MenuItem>
              {connection.auth === "oauth" && isConnected ? (
                <MenuItem onClick={onConnect}>Reconnect</MenuItem>
              ) : null}
              {connection.auth === "token" && isConnected ? (
                <MenuItem onClick={onSetToken}>Replace token…</MenuItem>
              ) : null}
              <MenuItem onClick={onEdit}>Edit…</MenuItem>
              {connection.authorizedAt !== null ? (
                <MenuItem onClick={onDisconnect}>Disconnect</MenuItem>
              ) : null}
              <MenuItem variant="destructive" onClick={onRemove}>
                Remove
              </MenuItem>
            </MenuPopup>
          </Menu>
        </div>
      </div>
    </div>
  );
}

function BrowseAppsSection({
  oauthClients,
  addedCatalogIds,
  disabled,
  onAdd,
  onAddCustom,
}: {
  oauthClients: AppsSettings["oauthClients"];
  addedCatalogIds: ReadonlySet<string>;
  disabled: boolean;
  onAdd: (entry: AppCatalogEntry, auth: AppAuthKind) => void;
  onAddCustom: () => void;
}) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<AppCategory | "all">("all");
  const entries = useMemo(() => filterAppCatalog(query, category), [category, query]);

  return (
    <SettingsSection
      {...searchableSetting("apps-browse")}
      title="Browse apps"
      icon={<StoreIcon className="size-4.5 text-muted-foreground" />}
      headerAction={
        <Button size="xs" variant="outline" disabled={disabled} onClick={onAddCustom}>
          <PlusIcon />
          Add custom MCP server…
        </Button>
      }
    >
      <div className="space-y-3 px-3 sm:px-4">
        <div className="relative max-w-72">
          <SearchIcon className="pointer-events-none absolute start-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            placeholder="Search apps"
            aria-label="Search apps"
            className="[&_[data-slot=input]]:ps-8"
          />
        </div>
        <div className="flex flex-wrap gap-1">
          {APP_CATEGORY_FILTERS.map((filter) => (
            <Button
              key={filter.id}
              size="xs"
              variant={category === filter.id ? "secondary" : "ghost-muted"}
              aria-pressed={category === filter.id}
              onClick={() => setCategory(filter.id)}
            >
              {filter.label}
            </Button>
          ))}
        </div>
        {entries.length === 0 ? (
          <p className="py-4 text-[13px] text-muted-foreground">No apps match.</p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {entries.map((entry) => (
              <AppCatalogCard
                key={entry.id}
                entry={entry}
                hint={appAuthHint(entry, oauthClients)}
                added={addedCatalogIds.has(entry.id)}
                disabled={disabled}
                onAdd={(auth) => onAdd(entry, auth)}
              />
            ))}
          </div>
        )}
      </div>
    </SettingsSection>
  );
}

function AppCatalogCard({
  entry,
  hint,
  added,
  disabled,
  onAdd,
}: {
  entry: AppCatalogEntry;
  hint: string;
  added: boolean;
  disabled: boolean;
  onAdd: (auth: AppAuthKind) => void;
}) {
  const alternateAuth: AppAuthKind = entry.auth === "oauth" ? "token" : "oauth";

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border/60 bg-card/40 p-3">
      <div className="flex min-w-0 items-start gap-2.5">
        <AppIcon entry={entry} size={28} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-foreground">{entry.name}</p>
          <p className="truncate text-xs text-muted-foreground">{hint}</p>
        </div>
      </div>
      <p className="line-clamp-2 text-[13px] leading-[1.4] text-muted-foreground/80">
        {entry.description}
      </p>
      <div className="flex justify-end">
        {added ? (
          <Badge variant="outline" size="sm" className="text-muted-foreground">
            Added
          </Badge>
        ) : entry.tokenSupported === true ? (
          <Menu>
            <MenuTrigger render={<Button size="xs" variant="outline" disabled={disabled} />}>
              Add
              <ChevronDownIcon className="size-3" />
            </MenuTrigger>
            <MenuPopup align="end" className="min-w-44">
              <MenuItem onClick={() => onAdd(entry.auth)}>{authChoiceLabel(entry.auth)}</MenuItem>
              <MenuItem onClick={() => onAdd(alternateAuth)}>
                {authChoiceLabel(alternateAuth)}
              </MenuItem>
            </MenuPopup>
          </Menu>
        ) : (
          <Button size="xs" variant="outline" disabled={disabled} onClick={() => onAdd(entry.auth)}>
            Add
          </Button>
        )}
      </div>
    </div>
  );
}

function authChoiceLabel(auth: AppAuthKind): string {
  if (auth === "token") return "Use an API token";
  if (auth === "none") return "Add without signing in";
  return "Connect with OAuth";
}

function OAuthClientsSection({
  oauthClients,
  disabled,
  onConfigure,
}: {
  oauthClients: AppsSettings["oauthClients"];
  disabled: boolean;
  onConfigure: (familyId: string) => void;
}) {
  return (
    <SettingsSection
      {...searchableSetting("apps-oauth-clients")}
      title="OAuth clients"
      icon={<KeyRoundIcon className="size-4.5 text-muted-foreground" />}
    >
      <p className="px-3 pb-2 text-[13px] leading-[1.45] text-muted-foreground/80 sm:px-4">
        Some services don&rsquo;t hand out clients automatically. Register one there, then paste its
        Client ID and secret here to connect their apps.
      </p>
      {APP_OAUTH_CLIENT_FAMILIES.map((family) => {
        const client = oauthClients[family.id];
        return (
          <div key={family.id} className={ITEM_ROW_CLASSNAME}>
            <div className={ITEM_ROW_INNER_CLASSNAME}>
              <div className="min-w-0 flex-1 space-y-0.5">
                <div className="flex items-center gap-2">
                  <h3 className="truncate text-sm font-medium text-foreground">{family.name}</h3>
                  <Badge variant={client ? "success" : "outline"} size="sm">
                    {client ? "Configured" : "Not configured"}
                  </Badge>
                </div>
                {client ? (
                  <p className="truncate font-mono text-xs text-muted-foreground">
                    {client.clientId}
                  </p>
                ) : null}
              </div>
              <Button
                size="xs"
                variant="outline"
                disabled={disabled}
                onClick={() => onConfigure(family.id)}
              >
                Configure…
              </Button>
            </div>
          </div>
        );
      })}
    </SettingsSection>
  );
}

function DialogField({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-foreground">{label}</span>
      {children}
      {hint === undefined ? null : (
        <span className="mt-1 block text-xs text-muted-foreground">{hint}</span>
      )}
    </label>
  );
}

/** Create a custom MCP server, or edit an existing connection's fields. */
function AppEditDialog({
  connection,
  takenSlugs,
  pending,
  onClose,
  onSave,
}: {
  connection: AppConnection | null;
  takenSlugs: ReadonlySet<string>;
  pending: boolean;
  onClose: () => void;
  onSave: (input: AppConnectionInput) => void;
}) {
  const isCustom = connection === null || connection.catalogId === null;
  const [name, setName] = useState(connection?.name ?? "");
  const [slug, setSlug] = useState(connection?.slug ?? "");
  const [slugEdited, setSlugEdited] = useState(connection !== null);
  const [url, setUrl] = useState(connection?.url ?? "");
  const [auth, setAuth] = useState<AppAuthKind>(connection?.auth ?? "oauth");
  const [scopes, setScopes] = useState(connection?.scopes ?? "");
  const [tokenHeader, setTokenHeader] = useState(connection?.tokenHeader ?? "Authorization");
  const [submitted, setSubmitted] = useState(false);

  const draft: AppConnectionDraft = {
    name,
    slug: slugEdited ? slug : deriveAppSlug(name),
    url,
    auth,
    scopes,
    tokenHeader,
  };
  const error = appDraftError(draft, takenSlugs);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogPopup className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {connection === null ? "Add MCP server" : `Edit ${connection.name}`}
          </DialogTitle>
          <DialogDescription>
            {connection !== null && connection.authorizedAt !== null
              ? "Changing the URL or auth type clears the stored credential."
              : "Point T3 at a remote MCP server (Streamable HTTP) and give it a mention slug."}
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="space-y-4">
          <DialogField label="Name">
            <Input
              value={name}
              onChange={(event) => setName(event.currentTarget.value)}
              placeholder="Acme"
              autoFocus
            />
          </DialogField>
          <DialogField label="Slug" hint="Agents reference this app as @slug.">
            <Input
              value={draft.slug}
              onChange={(event) => {
                setSlugEdited(true);
                setSlug(event.currentTarget.value);
              }}
              placeholder="acme"
              spellCheck={false}
            />
          </DialogField>
          {isCustom ? (
            <DialogField label="Server URL">
              <Input
                value={url}
                onChange={(event) => setUrl(event.currentTarget.value)}
                placeholder="https://mcp.acme.com/mcp"
                spellCheck={false}
              />
            </DialogField>
          ) : null}
          {connection === null ? (
            <DialogField label="Sign-in">
              <Select
                value={auth}
                onValueChange={(value) => value && setAuth(value as AppAuthKind)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="oauth">OAuth</SelectItem>
                  <SelectItem value="token">API token</SelectItem>
                  <SelectItem value="none">No sign-in</SelectItem>
                </SelectContent>
              </Select>
            </DialogField>
          ) : null}
          {auth === "oauth" ? (
            <DialogField label="Scopes" hint="Space-separated; empty uses the server's default.">
              <Input
                value={scopes}
                onChange={(event) => setScopes(event.currentTarget.value)}
                spellCheck={false}
              />
            </DialogField>
          ) : null}
          {auth === "token" ? (
            <DialogField
              label="Token header"
              hint="Authorization sends “Bearer <token>”; any other name sends the raw token."
            >
              <Input
                value={tokenHeader}
                onChange={(event) => setTokenHeader(event.currentTarget.value)}
                spellCheck={false}
              />
            </DialogField>
          ) : null}
          {submitted && error !== null ? (
            <p className="text-xs text-destructive-foreground">{error}</p>
          ) : null}
        </DialogPanel>
        <DialogFooter variant="bare">
          <Button variant="outline" disabled={pending} onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={pending}
            onClick={() => {
              setSubmitted(true);
              if (error !== null) return;
              onSave({
                id: connection?.id ?? AppConnectionId.make(randomUUID()),
                catalogId: connection?.catalogId ?? null,
                name: name.trim(),
                slug: draft.slug,
                url: url.trim(),
                auth,
                scopes: scopes.trim(),
                tokenHeader: tokenHeader.trim(),
                enabled: connection?.enabled ?? true,
              });
            }}
          >
            {pending ? <Spinner className="size-3.5" /> : null}
            {connection === null ? "Add" : "Save"}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

function AppTokenDialog({
  connection,
  pending,
  onClose,
  onSubmit,
}: {
  connection: AppConnection;
  pending: boolean;
  onClose: () => void;
  onSubmit: (token: string) => void;
}) {
  const [token, setToken] = useState("");
  const tokenHelpUrl = findAppCatalogEntry(connection.catalogId)?.tokenHelpUrl;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogPopup className="max-w-md">
        <DialogHeader>
          <DialogTitle>Connect {connection.name} with a token</DialogTitle>
          <DialogDescription>
            The token is stored on this environment and sent as the{" "}
            <code className="font-mono text-xs">{connection.tokenHeader}</code> header. It never
            reaches the provider CLI.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="space-y-3">
          <DialogField label="API token">
            <Input
              value={token}
              onChange={(event) => setToken(event.currentTarget.value)}
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder="Paste your token"
              autoFocus
            />
          </DialogField>
          {tokenHelpUrl === undefined ? null : (
            <Button size="xs" variant="ghost-muted" onClick={() => openExternalUrl(tokenHelpUrl)}>
              <ExternalLinkIcon />
              Where to get a token
            </Button>
          )}
        </DialogPanel>
        <DialogFooter variant="bare">
          <Button variant="outline" disabled={pending} onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={pending || token.trim().length === 0}
            onClick={() => onSubmit(token.trim())}
          >
            {pending ? <Spinner className="size-3.5" /> : null}
            Save token
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

function AppTestDialog({
  connection,
  result,
  error,
  onClose,
}: {
  connection: AppConnection;
  result: AppsTestResult | null;
  error: string | null;
  onClose: () => void;
}) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogPopup className="max-w-md">
        <DialogHeader>
          <DialogTitle>{connection.name} handshake</DialogTitle>
          <DialogDescription>
            {result === null
              ? `Talking to ${connection.url}`
              : `${result.tools.length} ${result.tools.length === 1 ? "tool" : "tools"}${
                  result.serverName === null ? "" : ` from ${result.serverName}`
                }`}
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          {error !== null ? (
            <p className="text-[13px] text-destructive-foreground">{error}</p>
          ) : result === null ? (
            <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
              <Spinner className="size-4" />
              Testing…
            </div>
          ) : result.tools.length === 0 ? (
            <p className="text-[13px] text-muted-foreground">
              The server connected but exposes no tools.
            </p>
          ) : (
            <ul className="space-y-1">
              {result.tools.map((tool) => (
                <li key={tool.name} className="min-w-0">
                  <p className="truncate font-mono text-xs text-foreground">{tool.name}</p>
                  {tool.description === null ? null : (
                    <p className="truncate text-xs text-muted-foreground">{tool.description}</p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </DialogPanel>
        <DialogFooter variant="bare">
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

function AppOAuthClientDialog({
  family,
  client,
  redirectUri,
  pending,
  onClose,
  onSave,
}: {
  family: AppOAuthClientFamily;
  client: AppsSettings["oauthClients"][string] | undefined;
  redirectUri: string | null;
  pending: boolean;
  onClose: () => void;
  /** `clientSecret` is `null` when the user never touched the field. */
  onSave: (clientId: string, clientSecret: string | null) => void;
}) {
  const [clientId, setClientId] = useState(client?.clientId ?? "");
  const [secret, setSecret] = useState<string | null>(null);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogPopup className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{family.name}</DialogTitle>
          <DialogDescription>
            Register the client with the redirect URI below, then paste its credentials here.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="space-y-4">
          <DialogField label="Client ID">
            <Input
              value={clientId}
              onChange={(event) => setClientId(event.currentTarget.value)}
              spellCheck={false}
              autoFocus
            />
          </DialogField>
          <DialogField label="Client secret">
            <DraftInput
              value={secret ?? ""}
              onCommit={setSecret}
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder={
                client?.hasClientSecret === true
                  ? "Stored secret — enter a new value to replace"
                  : "Client secret"
              }
            />
          </DialogField>
          <div>
            <span className="mb-1.5 block text-xs font-medium text-foreground">Redirect URI</span>
            {redirectUri === null ? (
              <p className="text-xs text-muted-foreground">
                Connect to this environment to see its redirect URI.
              </p>
            ) : (
              <div className="flex items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded-md border border-input bg-muted/40 px-2 py-1.5 font-mono text-xs text-foreground">
                  {redirectUri}
                </code>
                <Button
                  size="icon-sm"
                  variant="outline"
                  aria-label="Copy redirect URI"
                  onClick={() => {
                    void writeTextToClipboard(redirectUri, "redirect URI").then(
                      () => toastManager.add({ type: "success", title: "Redirect URI copied" }),
                      () =>
                        toastManager.add({
                          type: "error",
                          title: "Could not copy the redirect URI",
                        }),
                    );
                  }}
                >
                  <CopyIcon className="size-3.5" />
                </Button>
              </div>
            )}
          </div>
          <ol className="list-decimal space-y-1 ps-5 text-[13px] leading-[1.45] text-muted-foreground">
            {family.steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
          <Button
            size="xs"
            variant="ghost-muted"
            onClick={() => openExternalUrl(family.consoleUrl)}
          >
            <ExternalLinkIcon />
            Open console
          </Button>
        </DialogPanel>
        <DialogFooter variant="bare">
          {client === undefined ? null : (
            <Button
              variant="destructive-outline"
              disabled={pending}
              className="sm:me-auto"
              onClick={() => onSave("", null)}
            >
              Remove
            </Button>
          )}
          <Button variant="outline" disabled={pending} onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={pending || clientId.trim().length === 0}
            onClick={() => onSave(clientId.trim(), secret === null ? null : secret.trim())}
          >
            {pending ? <Spinner className="size-3.5" /> : null}
            Save
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

function AppConfirmDialog({
  title,
  description,
  confirmLabel,
  pending,
  onClose,
  onConfirm,
}: {
  title: string;
  description: string;
  confirmLabel: string;
  pending: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) onClose();
      }}
    >
      <AlertDialogPopup>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogClose disabled={pending} render={<Button variant="outline" />}>
            Cancel
          </AlertDialogClose>
          <Button variant="destructive" disabled={pending} onClick={onConfirm}>
            {pending ? <Spinner className="size-3.5" /> : null}
            {confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogPopup>
    </AlertDialog>
  );
}
