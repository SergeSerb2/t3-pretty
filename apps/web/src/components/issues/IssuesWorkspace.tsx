import { useEffect, useRef, useState } from "react";
import type {
  EnvironmentId,
  Issue,
  IssueConnection,
  IssueMetadata,
  IssueProvider,
} from "@t3tools/contracts";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import {
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import { ArrowLeftIcon, ExternalLinkIcon, PlusIcon, RefreshCwIcon } from "lucide-react";
import { useEnvironments, usePrimaryEnvironmentId } from "~/state/environments";
import { useProjects } from "~/state/entities";
import { serverEnvironment } from "~/state/server";
import { useEnvironmentQuery } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";
import { useNewThreadHandler } from "~/hooks/useHandleNewThread";
import { useComposerDraftStore } from "~/composerDraftStore";
import { ensureLocalApi } from "~/localApi";
import { isElectron } from "~/env";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { SidebarInset } from "../ui/sidebar";
import { WorkspacePageHeader } from "../WorkspacePageHeader";
import { toastManager } from "../ui/toast";

const selectClass =
  "h-9 min-w-0 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-2 focus-visible:outline-ring";
const textareaClass =
  "min-h-36 w-full rounded-md border border-input bg-background p-3 text-sm focus-visible:outline-2 focus-visible:outline-ring";
const emptyMetadata: IssueMetadata = { scopes: [], states: [], assignees: [] };
const names = { linear: "Linear", sentry: "Sentry" };

function failure(result: AtomCommandResult<unknown, unknown>): string | null {
  if (result._tag === "Success") return null;
  const error = squashAtomCommandFailure(result);
  return error instanceof Error ? error.message : "The request failed. Please try again.";
}
function ErrorMessage({ message }: { message: string | null }) {
  return message ? (
    <p role="alert" className="text-sm text-destructive">
      {message}
    </p>
  ) : null;
}

export function IssuesWorkspace() {
  const { environments } = useEnvironments();
  const primary = usePrimaryEnvironmentId();
  const [selected, setSelected] = useState<EnvironmentId | null>(null);
  const environmentId =
    environments.find((item) => item.environmentId === selected)?.environmentId ??
    primary ??
    environments[0]?.environmentId ??
    null;
  const environment = environments.find((item) => item.environmentId === environmentId);
  return (
    <SidebarInset className="h-full overflow-hidden">
      <WorkspacePageHeader electron={isElectron}>
        <h1 className="font-medium">Issues</h1>
        <select
          aria-label="Issue environment"
          className={`${selectClass} no-drag ml-auto max-w-64`}
          value={environmentId ?? ""}
          onChange={(event) => setSelected(event.target.value as EnvironmentId)}
        >
          {environments.map((item) => (
            <option key={item.environmentId} value={item.environmentId}>
              {item.label}
            </option>
          ))}
        </select>
      </WorkspacePageHeader>
      <div className="min-h-0 flex-1 overflow-auto p-5 sm:p-8">
        {environmentId && environment?.serverConfig?.environment.capabilities.issues ? (
          <IssueEnvironment key={environmentId} environmentId={environmentId} />
        ) : (
          <p className="text-sm text-muted-foreground">
            Connect to an environment with native issue management. Older environments need an
            update.
          </p>
        )}
      </div>
    </SidebarInset>
  );
}

function IssueEnvironment({ environmentId }: { environmentId: EnvironmentId }) {
  const connectionQuery = useEnvironmentQuery(
    serverEnvironment.issuesConnections({ environmentId, input: {} }),
  );
  const disconnect = useAtomCommand(serverEnvironment.issuesDisconnect, { reportFailure: false });
  const connections = connectionQuery.data;
  const [provider, setProvider] = useState<IssueProvider>("linear");
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [disconnecting, setDisconnecting] = useState(false);
  const [create, setCreate] = useState<{ source?: Issue } | null>(null);
  const connected = connections?.find((item) => item.provider === provider);
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5">
      <div className="flex flex-wrap items-center gap-2">
        {(["linear", "sentry"] as const).map((item) => (
          <Button
            key={item}
            variant={provider === item ? "secondary" : "ghost"}
            aria-pressed={provider === item}
            onClick={() => {
              setProvider(item);
              setCreate(null);
            }}
          >
            {names[item]}
          </Button>
        ))}
        {connected ? (
          <>
            <span className="ml-2 text-xs text-muted-foreground">{connected.account}</span>
            <Button
              className="ml-auto"
              variant="ghost"
              disabled={disconnecting}
              onClick={async () => {
                setDisconnecting(true);
                const result = await disconnect({ environmentId, input: { provider } });
                setDisconnecting(false);
                setError(failure(result));
                if (result._tag === "Success") {
                  connectionQuery.refresh();
                  setRevision((value) => value + 1);
                  setCreate(null);
                }
              }}
            >
              Disconnect
            </Button>
          </>
        ) : null}
      </div>
      <ErrorMessage message={error ?? connectionQuery.error} />
      {connections === null ? (
        connectionQuery.error ? (
          <Button onClick={connectionQuery.refresh}>Retry connection</Button>
        ) : (
          <p role="status">Loading connections…</p>
        )
      ) : create && connections.some((item) => item.provider === "linear") ? (
        <LinearEditor
          key="create"
          environmentId={environmentId}
          source={create.source}
          onCancel={() => setCreate(null)}
          onSaved={() => {
            setCreate(null);
            setRevision((value) => value + 1);
            setProvider("linear");
          }}
        />
      ) : connected ? (
        <IssueBrowser
          key={`${provider}:${revision}`}
          environmentId={environmentId}
          provider={provider}
          onCreate={(source) => {
            setProvider("linear");
            setCreate(source ? { source } : {});
          }}
        />
      ) : (
        <ConnectIssueService
          key={provider}
          environmentId={environmentId}
          provider={provider}
          onConnected={() => connectionQuery.refresh()}
        />
      )}
    </div>
  );
}

function ConnectIssueService({
  environmentId,
  provider,
  onConnected,
}: {
  environmentId: EnvironmentId;
  provider: IssueProvider;
  onConnected: (connection: IssueConnection) => void;
}) {
  const connect = useAtomCommand(serverEnvironment.issuesConnect, { reportFailure: false });
  const [token, setToken] = useState("");
  const [organization, setOrganization] = useState("");
  const [region, setRegion] = useState<"us" | "de">("us");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="flex max-w-lg flex-col gap-4 py-8"
      onSubmit={async (event) => {
        event.preventDefault();
        setPending(true);
        setError(null);
        const result = await connect({
          environmentId,
          input:
            provider === "linear"
              ? { provider, token: token.trim() }
              : { provider, token: token.trim(), organization: organization.trim(), region },
        });
        setPending(false);
        setError(failure(result));
        if (result._tag === "Success") {
          setToken("");
          onConnected(result.value);
        }
      }}
    >
      <h2 className="text-xl font-semibold">Connect {names[provider]}</h2>
      <p className="text-sm text-muted-foreground">
        {provider === "linear"
          ? "Use a personal API key with permission to read, create and update issues."
          : "Use a Sentry auth token with org:read, project:read and event:write permissions."}{" "}
        Your token stays on this environment.
      </p>
      <a
        className="text-sm underline"
        href={
          provider === "linear"
            ? "https://linear.app/settings/api"
            : "https://sentry.io/settings/account/api/auth-tokens/"
        }
        target="_blank"
        rel="noreferrer"
      >
        Create a {names[provider]} token
      </a>
      <label className="grid gap-1 text-sm">
        API token
        <Input
          type="password"
          autoComplete="off"
          required
          value={token}
          onChange={(event) => setToken(event.target.value)}
        />
      </label>
      {provider === "sentry" ? (
        <>
          <label className="grid gap-1 text-sm">
            Organization slug
            <Input
              required
              placeholder="my-organization"
              pattern="[a-z0-9][a-z0-9_-]{0,99}"
              value={organization}
              onChange={(event) => setOrganization(event.target.value)}
            />
          </label>
          <label className="grid gap-1 text-sm">
            Data region
            <select
              className={selectClass}
              value={region}
              onChange={(event) => setRegion(event.target.value === "de" ? "de" : "us")}
            >
              <option value="us">United States</option>
              <option value="de">European Union</option>
            </select>
          </label>
        </>
      ) : null}
      <ErrorMessage message={error} />
      <Button type="submit" disabled={pending || !token.trim()}>
        {pending ? "Connecting…" : "Connect"}
      </Button>
    </form>
  );
}

function IssueBrowser({
  environmentId,
  provider,
  onCreate,
}: {
  environmentId: EnvironmentId;
  provider: IssueProvider;
  onCreate: (source?: Issue) => void;
}) {
  const listGeneration = useRef(0);
  const list = useAtomCommand(serverEnvironment.issuesList, { reportFailure: false });
  const metadata = useAtomCommand(serverEnvironment.issuesMetadata, { reportFailure: false });
  const [options, setOptions] = useState<IssueMetadata>(emptyMetadata);
  const [scopeId, setScopeId] = useState("");
  const [query, setQuery] = useState(provider === "sentry" ? "is:unresolved" : "");
  const [search, setSearch] = useState(query);
  const [issues, setIssues] = useState<ReadonlyArray<Issue>>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Issue | null>(null);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let cancelled = false;
    void metadata({ environmentId, input: { provider } }).then((result) => {
      if (cancelled) return;
      if (result._tag === "Success") setOptions(result.value);
      else setError(failure(result));
    });
    return () => {
      cancelled = true;
    };
  }, [metadata, environmentId, provider]);
  useEffect(() => {
    let cancelled = false;
    listGeneration.current += 1;
    setPending(true);
    setIssues([]);
    setCursor(null);
    setError(null);
    void list({
      environmentId,
      input: { provider, query: search, ...(scopeId ? { scopeId } : {}) },
    }).then((result) => {
      if (cancelled) return;
      setPending(false);
      setError(failure(result));
      if (result._tag === "Success") {
        setIssues(result.value.issues);
        setCursor(result.value.nextCursor);
      }
    });
    return () => {
      cancelled = true;
      listGeneration.current += 1;
    };
  }, [list, environmentId, provider, scopeId, search, revision]);
  return (
    <>
      <form
        className="flex flex-wrap gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (pending) return;
          setSearch(query);
          setRevision((value) => value + 1);
        }}
      >
        <Input
          className="min-w-48 flex-1"
          aria-label="Search issues"
          placeholder={
            provider === "linear" ? "Search issue titles" : "Search Sentry, e.g. is:unresolved"
          }
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <select
          aria-label={provider === "linear" ? "Team" : "Project"}
          className={selectClass}
          value={scopeId}
          disabled={pending}
          onChange={(event) => {
            setScopeId(event.target.value);
            setSelected(null);
          }}
        >
          <option value="">{provider === "linear" ? "All teams" : "All projects"}</option>
          {options.scopes.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
        <Button type="submit" disabled={pending}>
          Search
        </Button>
        <Button
          type="button"
          variant="outline"
          aria-label="Refresh issues"
          disabled={pending}
          onClick={() => setRevision((value) => value + 1)}
        >
          <RefreshCwIcon className="size-4" />
        </Button>
        {provider === "linear" ? (
          <Button type="button" onClick={() => onCreate()}>
            <PlusIcon className="size-4" /> New issue
          </Button>
        ) : null}
      </form>
      <ErrorMessage message={error} />
      <div className="grid min-h-96 gap-6 lg:grid-cols-[minmax(260px,2fr)_3fr]">
        <div className={selected ? "hidden lg:block" : ""}>
          {pending && issues.length === 0 ? (
            <p role="status" className="p-4 text-sm text-muted-foreground">
              Loading issues…
            </p>
          ) : null}
          {!pending && issues.length === 0 && !error ? (
            <p className="p-4 text-sm text-muted-foreground">No issues match this search.</p>
          ) : null}
          <ul className="divide-y divide-border/50">
            {issues.map((issue) => (
              <li key={issue.id}>
                <button
                  type="button"
                  className={`w-full rounded-md p-3 text-left hover:bg-muted/60 focus-visible:outline-2 focus-visible:outline-ring ${selected?.id === issue.id ? "bg-muted" : ""}`}
                  onClick={() => setSelected(issue)}
                  aria-pressed={selected?.id === issue.id}
                >
                  <span className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                    <span>{issue.identifier}</span>
                    <span>{issue.state.name}</span>
                  </span>
                  <span className="mt-1 block text-sm font-medium">{issue.title}</span>
                  <span className="mt-1 block text-xs text-muted-foreground">
                    {issue.scope.name}
                    {issue.assignee ? ` · ${issue.assignee.name}` : ""}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {cursor ? (
            <Button
              className="mt-4 w-full"
              variant="outline"
              disabled={pending}
              onClick={async () => {
                const generation = listGeneration.current;
                setPending(true);
                const result = await list({
                  environmentId,
                  input: { provider, query: search, cursor, ...(scopeId ? { scopeId } : {}) },
                });
                if (generation !== listGeneration.current) return;
                setPending(false);
                setError(failure(result));
                if (result._tag === "Success") {
                  setIssues((current) => [
                    ...current,
                    ...result.value.issues.filter(
                      (item) => !current.some((existing) => existing.id === item.id),
                    ),
                  ]);
                  setCursor(result.value.nextCursor);
                }
              }}
            >
              {pending ? "Loading…" : "Load more"}
            </Button>
          ) : null}
        </div>
        {selected ? (
          <IssueDetail
            key={selected.id}
            environmentId={environmentId}
            issue={selected}
            onBack={() => setSelected(null)}
            onCreate={onCreate}
            onSaved={(issue) => {
              setSelected(issue);
              setRevision((value) => value + 1);
            }}
          />
        ) : (
          <div className="hidden items-center justify-center rounded-lg bg-muted/20 text-sm text-muted-foreground lg:flex">
            Select an issue to view and manage it.
          </div>
        )}
      </div>
    </>
  );
}

function IssueDetail({
  environmentId,
  issue: initialIssue,
  onBack,
  onCreate,
  onSaved,
}: {
  environmentId: EnvironmentId;
  issue: Issue;
  onBack: () => void;
  onCreate: (source: Issue) => void;
  onSaved: (issue: Issue) => void;
}) {
  const loadDetail = useAtomCommand(serverEnvironment.issuesDetail, { reportFailure: false });
  const [detail, setDetail] = useState<Issue | null>(null);
  const [detailRevision, setDetailRevision] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const issue = detail ?? initialIssue;
  useEffect(() => {
    let cancelled = false;
    setDetail(null);
    void loadDetail({
      environmentId,
      input: { provider: initialIssue.provider, id: initialIssue.id },
    }).then((result) => {
      if (cancelled) return;
      if (result._tag === "Success") setDetail(result.value);
      else setError(failure(result));
    });
    return () => {
      cancelled = true;
    };
  }, [environmentId, initialIssue, loadDetail, detailRevision]);
  const [editing, setEditing] = useState(false);
  const [comment, setComment] = useState("");
  const [pending, setPending] = useState(false);
  const update = useAtomCommand(serverEnvironment.issuesUpdate, { reportFailure: false });
  const addComment = useAtomCommand(serverEnvironment.issuesComment, { reportFailure: false });
  const projects = useProjects().filter((project) => project.environmentId === environmentId);
  const [projectId, setProjectId] = useState("");
  const newThread = useNewThreadHandler();
  if (editing && issue.provider === "sentry")
    return (
      <SentryEditor
        environmentId={environmentId}
        issue={issue}
        onCancel={() => setEditing(false)}
        onSaved={(saved) => {
          setEditing(false);
          onSaved(saved);
        }}
      />
    );
  if (editing)
    return (
      <LinearEditor
        environmentId={environmentId}
        issue={issue}
        onCancel={() => setEditing(false)}
        onSaved={(saved) => {
          setEditing(false);
          onSaved(saved);
        }}
      />
    );
  return (
    <section className="flex min-w-0 flex-col gap-4">
      <Button className="self-start lg:hidden" variant="ghost" onClick={onBack}>
        <ArrowLeftIcon className="size-4" /> Issues
      </Button>
      <div>
        <span className="text-xs text-muted-foreground">
          {issue.identifier} · {issue.state.name}
        </span>
        <h2 className="mt-1 text-xl font-semibold">{issue.title}</h2>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          onClick={() => void ensureLocalApi().shell.openExternal(issue.url)}
        >
          <ExternalLinkIcon className="size-4" /> Open in {names[issue.provider]}
        </Button>
        {issue.provider === "linear" ? (
          <Button onClick={() => setEditing(true)}>Edit issue</Button>
        ) : (
          <>
            <select
              aria-label="Sentry status"
              className={selectClass}
              disabled={pending}
              value={issue.state.id}
              onChange={async (event) => {
                const status = event.target.value as "unresolved" | "resolved" | "ignored";
                setPending(true);
                const result = await update({
                  environmentId,
                  input: { provider: "sentry", id: issue.id, status },
                });
                setPending(false);
                setError(failure(result));
                if (result._tag === "Success") onSaved(result.value);
              }}
            >
              <option value="unresolved">Unresolved</option>
              <option value="resolved">Resolved</option>
              <option value="ignored">Archived</option>
            </select>
            <Button variant="outline" onClick={() => onCreate(issue)}>
              Create Linear issue
            </Button>
            <Button variant="outline" onClick={() => setEditing(true)}>
              Edit issue
            </Button>
          </>
        )}
      </div>
      <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">
        {issue.description || "No description."}
      </p>
      {issue.details ? (
        <section className="grid gap-2">
          <h3 className="text-sm font-medium">
            {issue.provider === "linear" ? "Recent comments" : "Latest event"}
          </h3>
          <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-muted/40 p-3 text-xs">
            {issue.details}
          </pre>
        </section>
      ) : null}
      <div className="flex flex-wrap gap-2 border-t pt-4">
        <select
          aria-label="Thread project"
          className={`${selectClass} flex-1`}
          value={projectId}
          onChange={(event) => setProjectId(event.target.value)}
        >
          <option value="">Choose a project</option>
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.title}
            </option>
          ))}
        </select>
        <Button
          disabled={pending || !projectId}
          onClick={async () => {
            const project = projects.find((item) => item.id === projectId);
            if (!project) return;
            setPending(true);
            try {
              const opened = await newThread(scopeProjectRef(environmentId, project.id));
              if (!opened) {
                setError("Could not open a thread.");
                return;
              }
              const store = useComposerDraftStore.getState();
              const existing = store.getComposerDraft(opened.draftId)?.prompt ?? "";
              store.setPrompt(
                opened.draftId,
                [
                  existing,
                  `Investigate ${issue.identifier}: ${issue.title}\n${issue.url}\n\n${issue.description}\n\n${issue.details ?? ""}`,
                ]
                  .filter(Boolean)
                  .join("\n\n"),
              );
            } catch {
              setError("Could not open a thread. Please try again.");
            } finally {
              setPending(false);
            }
          }}
        >
          Start thread
        </Button>
      </div>
      {issue.provider === "linear" ? (
        <form
          className="grid gap-2 border-t pt-4"
          onSubmit={async (event) => {
            event.preventDefault();
            setPending(true);
            const result = await addComment({
              environmentId,
              input: { id: issue.id, body: comment.trim() },
            });
            setPending(false);
            setError(failure(result));
            if (result._tag === "Success") {
              setComment("");
              setDetailRevision((value) => value + 1);
              toastManager.add({ type: "success", title: "Comment added" });
            }
          }}
        >
          <label className="grid gap-1 text-sm">
            Comment
            <textarea
              className={textareaClass}
              required
              value={comment}
              onChange={(event) => setComment(event.target.value)}
            />
          </label>
          <Button
            className="justify-self-start"
            type="submit"
            disabled={pending || !comment.trim()}
          >
            Add comment
          </Button>
        </form>
      ) : null}
      <ErrorMessage message={error} />
    </section>
  );
}

function SentryEditor({
  environmentId,
  issue,
  onCancel,
  onSaved,
}: {
  environmentId: EnvironmentId;
  issue: Issue;
  onCancel: () => void;
  onSaved: (issue: Issue) => void;
}) {
  const update = useAtomCommand(serverEnvironment.issuesUpdate, { reportFailure: false });
  const [status, setStatus] = useState(issue.state.id);
  const [priority, setPriority] = useState(issue.priority);
  const [assignee, setAssignee] = useState(issue.assignee?.id ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={async (event) => {
        event.preventDefault();
        setPending(true);
        const result = await update({
          environmentId,
          input: {
            provider: "sentry",
            id: issue.id,
            status: status as "resolved" | "unresolved" | "ignored",
            priority: priority as "low" | "medium" | "high",
            assignedTo: assignee.trim() || null,
          },
        });
        setPending(false);
        setError(failure(result));
        if (result._tag === "Success") onSaved(result.value);
      }}
    >
      <h2 className="text-xl font-semibold">Edit {issue.identifier}</h2>
      <label className="grid gap-1 text-sm">
        Status
        <select
          className={selectClass}
          value={status}
          onChange={(event) => setStatus(event.target.value)}
        >
          <option value="unresolved">Unresolved</option>
          <option value="resolved">Resolved</option>
          <option value="ignored">Archived</option>
        </select>
      </label>
      <label className="grid gap-1 text-sm">
        Priority
        <select
          className={selectClass}
          value={priority}
          onChange={(event) => setPriority(event.target.value)}
        >
          {["low", "medium", "high"].map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
      </label>
      <label className="grid gap-1 text-sm">
        Assignee
        <Input
          placeholder="user:ID or team:ID; empty to unassign"
          value={assignee}
          onChange={(event) => setAssignee(event.target.value)}
        />
      </label>
      <ErrorMessage message={error} />
      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save changes"}
        </Button>
        <Button type="button" variant="ghost" disabled={pending} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function LinearEditor({
  environmentId,
  issue,
  source,
  onCancel,
  onSaved,
}: {
  environmentId: EnvironmentId;
  issue?: Issue;
  source?: Issue | undefined;
  onCancel: () => void;
  onSaved: (issue: Issue) => void;
}) {
  const metadata = useAtomCommand(serverEnvironment.issuesMetadata, { reportFailure: false });
  const create = useAtomCommand(serverEnvironment.issuesCreate, { reportFailure: false });
  const update = useAtomCommand(serverEnvironment.issuesUpdate, { reportFailure: false });
  const [options, setOptions] = useState<IssueMetadata>(emptyMetadata);
  const [team, setTeam] = useState(issue?.scope.id ?? "");
  const [title, setTitle] = useState(issue?.title ?? source?.title ?? "");
  const [description, setDescription] = useState(
    issue?.description ??
      (source
        ? `${source.url}\n\n${source.description}\n\n${source.details ?? ""}`.slice(0, 100_000)
        : ""),
  );
  const [state, setState] = useState(issue?.state.id ?? "");
  const [assignee, setAssignee] = useState(issue?.assignee?.id ?? "");
  const [priority, setPriority] = useState(issue?.priority ?? "0");
  const [pending, setPending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void metadata({
      environmentId,
      input: { provider: "linear", ...(team ? { scopeId: team } : {}) },
    }).then((result) => {
      if (cancelled) return;
      setLoading(false);
      setError(failure(result));
      if (result._tag === "Success") setOptions(result.value);
    });
    return () => {
      cancelled = true;
    };
  }, [metadata, environmentId, team]);
  return (
    <form
      className="flex max-w-2xl flex-col gap-4"
      onSubmit={async (event) => {
        event.preventDefault();
        setPending(true);
        const fields = {
          title: title.trim(),
          description,
          ...(state ? { stateId: state } : {}),
          assigneeId: assignee || null,
          priority: Number(priority),
        };
        const result = issue
          ? await update({ environmentId, input: { provider: "linear", id: issue.id, ...fields } })
          : await create({ environmentId, input: { teamId: team, ...fields } });
        setPending(false);
        setError(failure(result));
        if (result._tag === "Success") onSaved(result.value);
      }}
    >
      <h2 className="text-xl font-semibold">
        {issue ? `Edit ${issue.identifier}` : "New Linear issue"}
      </h2>
      <label className="grid gap-1 text-sm">
        Team
        <select
          className={selectClass}
          required
          disabled={!!issue || loading}
          value={team}
          onChange={(event) => {
            setTeam(event.target.value);
            setState("");
            setAssignee("");
          }}
        >
          <option value="">Choose a team</option>
          {options.scopes.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
      </label>
      <label className="grid gap-1 text-sm">
        Title
        <Input
          required
          maxLength={512}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
      </label>
      <label className="grid gap-1 text-sm">
        Description
        <textarea
          className={textareaClass}
          maxLength={100000}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
      </label>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="grid gap-1 text-sm">
          Status
          <select
            className={selectClass}
            value={state}
            disabled={loading}
            onChange={(event) => setState(event.target.value)}
          >
            <option value="">Team default</option>
            {options.states.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          Assignee
          <select
            className={selectClass}
            value={assignee}
            disabled={loading}
            onChange={(event) => setAssignee(event.target.value)}
          >
            <option value="">Unassigned</option>
            {options.assignees.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          Priority
          <select
            className={selectClass}
            value={priority}
            onChange={(event) => setPriority(event.target.value)}
          >
            {["No priority", "Urgent", "High", "Normal", "Low"].map((name, index) => (
              <option key={name} value={index}>
                {name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <ErrorMessage message={error} />
      <div className="flex gap-2">
        <Button type="submit" disabled={pending || loading || !team || !title.trim()}>
          {pending ? "Saving…" : issue ? "Save changes" : "Create issue"}
        </Button>
        <Button type="button" variant="ghost" disabled={pending} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
