import { useEffect, useRef, useState } from "react";
import * as Clipboard from "expo-clipboard";
import { Alert, Linking, Pressable, ScrollView, View } from "react-native";
import type { EnvironmentId, Issue, IssueMetadata, IssueProvider } from "@t3tools/contracts";
import {
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import { AppText as Text, AppTextInput as TextInput } from "../../components/AppText";
import { AnchoredMenu } from "../../components/AndroidAnchoredMenu";
import { serverEnvironment } from "../../state/server";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { useServerConfigs } from "../../state/entities";
import { useSavedRemoteConnections } from "../../state/use-remote-environment-registry";

const names = { linear: "Linear", sentry: "Sentry" };
const emptyMetadata: IssueMetadata = { scopes: [], states: [], assignees: [] };
function message(result: AtomCommandResult<unknown, unknown>) {
  if (result._tag === "Success") return null;
  const error = squashAtomCommandFailure(result);
  return error instanceof Error ? error.message : "The request failed. Try again.";
}
function Action({
  title,
  onPress,
  disabled = false,
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      className={`min-h-11 justify-center rounded-xl bg-surface px-4 py-3 ${disabled ? "opacity-50" : ""}`}
    >
      <Text className="text-sm font-medium text-foreground">{title}</Text>
    </Pressable>
  );
}
function Field({
  label,
  value,
  onChange,
  secure = false,
  multiline = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  secure?: boolean;
  multiline?: boolean;
}) {
  return (
    <View className="gap-1">
      <Text className="text-sm text-muted-foreground">{label}</Text>
      <TextInput
        accessibilityLabel={label}
        className="min-h-11 rounded-xl bg-surface px-4 py-3 text-foreground"
        value={value}
        onChangeText={onChange}
        secureTextEntry={secure}
        multiline={multiline}
        autoCapitalize="none"
        autoCorrect={!secure}
      />
    </View>
  );
}
function Choose({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: ReadonlyArray<{ id: string; name: string }>;
  onChange: (id: string) => void;
}) {
  return (
    <AnchoredMenu
      title={label}
      actions={options.map((item) => ({
        id: item.id || "__empty",
        title: item.name,
        state: item.id === value ? "on" : "off",
      }))}
      onPressAction={({ nativeEvent }) =>
        onChange(nativeEvent.event === "__empty" ? "" : nativeEvent.event)
      }
    >
      <View
        accessibilityRole="button"
        accessibilityLabel={label}
        className="min-h-11 justify-center rounded-xl bg-surface px-4 py-3"
      >
        <Text className="text-sm text-foreground">
          {label}: {options.find((item) => item.id === value)?.name ?? "Choose"}
        </Text>
      </View>
    </AnchoredMenu>
  );
}

export function IssuesRouteScreen() {
  const { savedConnectionsById } = useSavedRemoteConnections();
  const configs = useServerConfigs();
  const environments = Object.values(savedConnectionsById);
  const [selected, setSelected] = useState<string>("");
  const environmentId =
    environments.find((item) => item.environmentId === selected)?.environmentId ??
    environments[0]?.environmentId ??
    null;
  return (
    <ScrollView
      className="flex-1 bg-screen"
      contentInsetAdjustmentBehavior="automatic"
      contentContainerClassName="gap-4 px-5 pt-4 pb-12"
      keyboardShouldPersistTaps="handled"
    >
      <Choose
        label="Environment"
        value={environmentId ?? ""}
        options={environments.map((item) => ({
          id: item.environmentId,
          name: item.environmentLabel,
        }))}
        onChange={setSelected}
      />
      {environmentId && configs.get(environmentId)?.environment.capabilities.issues ? (
        <IssuesEnvironment key={environmentId} environmentId={environmentId} />
      ) : (
        <Text className="text-muted-foreground">
          Connect to an environment with native issue management. Older environments need an update.
        </Text>
      )}
    </ScrollView>
  );
}

function IssuesEnvironment({ environmentId }: { environmentId: EnvironmentId }) {
  const connectionQuery = useEnvironmentQuery(
    serverEnvironment.issuesConnections({ environmentId, input: {} }),
  );
  const disconnect = useAtomCommand(serverEnvironment.issuesDisconnect, { reportFailure: false });
  const accounts = connectionQuery.data;
  const [provider, setProvider] = useState<IssueProvider>("linear");
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [creating, setCreating] = useState(false);
  const [source, setSource] = useState<Issue | undefined>();
  const account = accounts?.find((item) => item.provider === provider);
  return (
    <View className="gap-4">
      <View className="flex-row gap-2">
        {(["linear", "sentry"] as const).map((item) => (
          <Pressable
            key={item}
            accessibilityRole="button"
            accessibilityState={{ selected: provider === item }}
            onPress={() => {
              setProvider(item);
              setCreating(false);
            }}
            className="min-h-11 justify-center rounded-xl bg-surface px-5"
          >
            <Text
              className={provider === item ? "font-bold text-foreground" : "text-muted-foreground"}
            >
              {names[item]}
            </Text>
          </Pressable>
        ))}
      </View>
      {error || connectionQuery.error ? (
        <Text accessibilityRole="alert" className="text-destructive">
          {error ?? connectionQuery.error}
        </Text>
      ) : null}
      {accounts === null ? (
        connectionQuery.error ? (
          <Action title="Retry connection" onPress={connectionQuery.refresh} />
        ) : (
          <Text>Loading connections…</Text>
        )
      ) : account ? (
        <>
          <Text className="text-muted-foreground">{account.account}</Text>
          {creating ? (
            <IssueEditor
              environmentId={environmentId}
              issue={undefined}
              source={source}
              onBack={() => {
                setCreating(false);
                setRevision((value) => value + 1);
              }}
            />
          ) : (
            <IssueBrowser
              key={`${provider}:${revision}`}
              environmentId={environmentId}
              provider={provider}
              onCreate={(issue) => {
                setSource(issue);
                setCreating(true);
                setProvider("linear");
              }}
            />
          )}
          <Action
            title={`Disconnect ${names[provider]}`}
            onPress={() => {
              void disconnect({ environmentId, input: { provider } }).then((result) => {
                setError(message(result));
                if (result._tag === "Success") {
                  connectionQuery.refresh();
                  setRevision((value) => value + 1);
                }
              });
            }}
          />
        </>
      ) : (
        <ConnectionForm
          key={provider}
          provider={provider}
          environmentId={environmentId}
          onConnected={() => {
            connectionQuery.refresh();
            setRevision((value) => value + 1);
          }}
        />
      )}
    </View>
  );
}

function ConnectionForm({
  provider,
  environmentId,
  onConnected,
}: {
  provider: IssueProvider;
  environmentId: EnvironmentId;
  onConnected: () => void;
}) {
  const connect = useAtomCommand(serverEnvironment.issuesConnect, { reportFailure: false });
  const [token, setToken] = useState("");
  const [organization, setOrganization] = useState("");
  const [region, setRegion] = useState("us");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <View className="gap-4">
      <Text className="text-xl font-semibold text-foreground">Connect {names[provider]}</Text>
      <Text className="text-sm text-muted-foreground">
        {provider === "linear"
          ? "Use a personal API key with permission to read, create and update issues."
          : "Use a Sentry auth token with org:read, project:read and event:write permissions."}{" "}
        Your token stays on this environment.
      </Text>
      <Action
        title="Create an API token"
        onPress={() => {
          void Linking.openURL(
            provider === "linear"
              ? "https://linear.app/settings/api"
              : "https://sentry.io/settings/account/api/auth-tokens/",
          );
        }}
      />
      <Field label="API token" secure value={token} onChange={setToken} />
      {provider === "sentry" ? (
        <>
          <Field label="Organization slug" value={organization} onChange={setOrganization} />
          <Choose
            label="Data region"
            value={region}
            options={[
              { id: "us", name: "United States" },
              { id: "de", name: "European Union" },
            ]}
            onChange={setRegion}
          />
        </>
      ) : null}
      {error ? (
        <Text accessibilityRole="alert" className="text-destructive">
          {error}
        </Text>
      ) : null}
      <Action
        title={pending ? "Connecting…" : "Connect"}
        disabled={pending || !token.trim() || (provider === "sentry" && !organization.trim())}
        onPress={() => {
          setPending(true);
          void connect({
            environmentId,
            input:
              provider === "linear"
                ? { provider, token: token.trim() }
                : {
                    provider,
                    token: token.trim(),
                    organization: organization.trim(),
                    region: region === "de" ? "de" : "us",
                  },
          }).then((result) => {
            setPending(false);
            setError(message(result));
            if (result._tag === "Success") {
              setToken("");
              onConnected();
            }
          });
        }}
      />
    </View>
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
  const [query, setQuery] = useState(provider === "sentry" ? "is:unresolved" : "");
  const [search, setSearch] = useState(query);
  const [scope, setScope] = useState("");
  const [options, setOptions] = useState<IssueMetadata>(emptyMetadata);
  const [issues, setIssues] = useState<ReadonlyArray<Issue>>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [selected, setSelected] = useState<Issue | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let cancelled = false;
    void metadata({ environmentId, input: { provider } }).then((result) => {
      if (!cancelled) {
        if (result._tag === "Success") setOptions(result.value);
        else setError(message(result));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [environmentId, provider, metadata]);
  useEffect(() => {
    let cancelled = false;
    listGeneration.current += 1;
    setPending(true);
    setIssues([]);
    setCursor(null);
    setError(null);
    void list({
      environmentId,
      input: { provider, query: search, ...(scope ? { scopeId: scope } : {}) },
    }).then((result) => {
      if (cancelled) return;
      setPending(false);
      setError(message(result));
      if (result._tag === "Success") {
        setIssues(result.value.issues);
        setCursor(result.value.nextCursor);
      }
    });
    return () => {
      cancelled = true;
      listGeneration.current += 1;
    };
  }, [environmentId, provider, list, scope, search, revision]);
  if (selected)
    return (
      <IssueDetail
        key={selected.id}
        environmentId={environmentId}
        issue={selected}
        onCreate={onCreate}
        onBack={() => {
          setSelected(null);
          setRevision((value) => value + 1);
        }}
      />
    );
  return (
    <View className="gap-3">
      <Field
        label={provider === "linear" ? "Search issue titles" : "Sentry search"}
        value={query}
        onChange={setQuery}
      />
      <Choose
        label={provider === "linear" ? "Team" : "Project"}
        value={scope}
        options={[{ id: "", name: "All" }, ...options.scopes]}
        onChange={(value) => {
          if (!pending) setScope(value);
        }}
      />
      <View className="flex-row gap-2">
        <Action
          title={pending ? "Loading…" : "Search / refresh"}
          disabled={pending}
          onPress={() => {
            setSearch(query);
            setRevision((value) => value + 1);
          }}
        />
        {provider === "linear" ? <Action title="New issue" onPress={() => onCreate()} /> : null}
      </View>
      {error ? (
        <Text accessibilityRole="alert" className="text-destructive">
          {error}
        </Text>
      ) : null}
      {!pending && !error && issues.length === 0 ? (
        <Text className="text-muted-foreground">No issues match this search.</Text>
      ) : null}
      {issues.map((issue) => (
        <Pressable
          key={issue.id}
          accessibilityRole="button"
          onPress={() => setSelected(issue)}
          className="gap-1 rounded-xl bg-surface p-4"
        >
          <Text className="text-xs text-muted-foreground">
            {issue.identifier} · {issue.state.name}
          </Text>
          <Text className="font-medium text-foreground">{issue.title}</Text>
          <Text className="text-xs text-muted-foreground">{issue.scope.name}</Text>
        </Pressable>
      ))}
      {cursor ? (
        <Action
          title="Load more"
          disabled={pending}
          onPress={() => {
            const generation = listGeneration.current;
            setPending(true);
            void list({
              environmentId,
              input: { provider, query: search, cursor, ...(scope ? { scopeId: scope } : {}) },
            }).then((result) => {
              if (generation !== listGeneration.current) return;
              setPending(false);
              setError(message(result));
              if (result._tag === "Success") {
                setIssues((items) => [
                  ...items,
                  ...result.value.issues.filter(
                    (item) => !items.some((existing) => existing.id === item.id),
                  ),
                ]);
                setCursor(result.value.nextCursor);
              }
            });
          }}
        />
      ) : null}
    </View>
  );
}

function IssueDetail({
  environmentId,
  issue,
  onBack,
  onCreate,
}: {
  environmentId: EnvironmentId;
  issue: Issue;
  onBack: () => void;
  onCreate: (source: Issue) => void;
}) {
  const load = useAtomCommand(serverEnvironment.issuesDetail, { reportFailure: false });
  const [detail, setDetail] = useState<Issue | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let cancelled = false;
    void load({ environmentId, input: { provider: issue.provider, id: issue.id } }).then(
      (result) => {
        if (cancelled) return;
        setError(message(result));
        if (result._tag === "Success") setDetail(result.value);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [environmentId, issue, load, revision]);
  return (
    <View className="gap-4">
      {error ? (
        <>
          <Text accessibilityRole="alert" className="text-destructive">
            {error}
          </Text>
          <Action title="Retry" onPress={() => setRevision((value) => value + 1)} />
        </>
      ) : null}
      {detail ? (
        <IssueEditor
          environmentId={environmentId}
          issue={detail}
          onBack={onBack}
          onCreate={onCreate}
          onComment={() => setRevision((value) => value + 1)}
        />
      ) : (
        <>
          <Action title="Back to issues" onPress={onBack} />
          <Text>Loading issue…</Text>
        </>
      )}
    </View>
  );
}

function IssueEditor({
  environmentId,
  issue,
  source,
  onBack,
  onCreate,
  onComment,
}: {
  environmentId: EnvironmentId;
  issue: Issue | undefined;
  source?: Issue | undefined;
  onBack: () => void;
  onCreate?: (source: Issue) => void;
  onComment?: () => void;
}) {
  const metadata = useAtomCommand(serverEnvironment.issuesMetadata, { reportFailure: false });
  const create = useAtomCommand(serverEnvironment.issuesCreate, { reportFailure: false });
  const update = useAtomCommand(serverEnvironment.issuesUpdate, { reportFailure: false });
  const addComment = useAtomCommand(serverEnvironment.issuesComment, { reportFailure: false });
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
  const [comment, setComment] = useState("");
  const [pending, setPending] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const provider = issue?.provider ?? "linear";
  useEffect(() => {
    if (provider !== "linear") return;
    let cancelled = false;
    setLoading(true);
    void metadata({ environmentId, input: { provider, ...(team ? { scopeId: team } : {}) } }).then(
      (result) => {
        if (cancelled) return;
        setLoading(false);
        setError(message(result));
        if (result._tag === "Success") setOptions(result.value);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [environmentId, provider, team, metadata]);
  return (
    <View className="gap-4">
      <Action title="Back to issues" disabled={pending} onPress={onBack} />
      <Text className="text-xl font-semibold text-foreground">
        {issue?.identifier ?? "New Linear issue"}
      </Text>
      {issue ? (
        <Action
          title={`Open in ${names[provider]}`}
          onPress={() => {
            void Linking.openURL(issue.url);
          }}
        />
      ) : null}
      {provider === "linear" ? (
        <>
          {!issue ? (
            <Choose
              label="Team"
              value={team}
              options={options.scopes}
              onChange={(value) => {
                setTeam(value);
                setState("");
                setAssignee("");
              }}
            />
          ) : null}
          <Field label="Title" value={title} onChange={setTitle} />
          <Field label="Description" multiline value={description} onChange={setDescription} />
          <Choose
            label="Status"
            value={state}
            options={[{ id: "", name: "Team default" }, ...options.states]}
            onChange={setState}
          />
          <Choose
            label="Assignee"
            value={assignee}
            options={[{ id: "", name: "Unassigned" }, ...options.assignees]}
            onChange={setAssignee}
          />
          <Choose
            label="Priority"
            value={priority}
            options={["No priority", "Urgent", "High", "Normal", "Low"].map((name, id) => ({
              id: String(id),
              name,
            }))}
            onChange={setPriority}
          />
        </>
      ) : (
        <>
          <Text className="text-lg font-medium text-foreground">{title}</Text>
          <Text selectable className="text-foreground">
            {description}
          </Text>
          <Choose
            label="Status"
            value={state}
            options={[
              { id: "unresolved", name: "Unresolved" },
              { id: "resolved", name: "Resolved" },
              { id: "ignored", name: "Archived" },
            ]}
            onChange={setState}
          />
          <Choose
            label="Priority"
            value={priority}
            options={["low", "medium", "high"].map((id) => ({ id, name: id }))}
            onChange={setPriority}
          />
          <Field
            label="Assignee (email or team:ID; empty to unassign)"
            value={assignee}
            onChange={setAssignee}
          />
        </>
      )}
      {issue?.details ? (
        <View className="gap-2">
          <Text className="font-semibold text-foreground">
            {provider === "linear" ? "Recent comments" : "Latest event"}
          </Text>
          <Text selectable className="text-sm text-foreground">
            {issue.details}
          </Text>
        </View>
      ) : null}
      {issue ? (
        <Action
          title="Copy issue context"
          onPress={() => {
            void Clipboard.setStringAsync(
              `${issue.identifier}: ${issue.title}\n${issue.url}\n\n${issue.description}\n\n${issue.details ?? ""}`,
            ).then(() =>
              Alert.alert(
                "Issue context copied",
                "Paste it into a thread to investigate with your agent.",
              ),
            );
          }}
        />
      ) : null}
      {issue?.provider === "sentry" && onCreate ? (
        <Action title="Create Linear issue" onPress={() => onCreate(issue)} />
      ) : null}
      {error ? (
        <Text accessibilityRole="alert" className="text-destructive">
          {error}
        </Text>
      ) : null}
      <Action
        title={pending ? "Saving…" : issue ? "Save changes" : "Create issue"}
        disabled={pending || loading || (provider === "linear" && (!title.trim() || !team))}
        onPress={() => {
          setPending(true);
          const fields = {
            title: title.trim(),
            description,
            ...(state ? { stateId: state } : {}),
            assigneeId: assignee || null,
            priority: Number(priority),
          };
          const request = issue
            ? update({
                environmentId,
                input:
                  provider === "linear"
                    ? { provider, id: issue.id, ...fields }
                    : {
                        provider,
                        id: issue.id,
                        status: state as "resolved" | "unresolved" | "ignored",
                        assignedTo: assignee || null,
                        priority: priority as "low" | "medium" | "high",
                      },
              })
            : create({ environmentId, input: { teamId: team, ...fields } });
          void request.then((result) => {
            setPending(false);
            setError(message(result));
            if (result._tag === "Success") onBack();
          });
        }}
      />
      {issue && provider === "linear" ? (
        <>
          <Field label="Comment" multiline value={comment} onChange={setComment} />
          <Action
            title="Add comment"
            disabled={pending || !comment.trim()}
            onPress={() => {
              setPending(true);
              void addComment({
                environmentId,
                input: { id: issue.id, body: comment.trim() },
              }).then((result) => {
                setPending(false);
                setError(message(result));
                if (result._tag === "Success") {
                  setComment("");
                  onComment?.();
                  Alert.alert("Comment added");
                }
              });
            }}
          />
        </>
      ) : null}
    </View>
  );
}
