import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { currentUser } from "@/lib/auth";
import { activityFeed, activityNotifications, analytics, getBoard, listCanvases, listCanvasTags, listMembers, listFields, listMembersWithPresence, listMeetings, listProjects, listSprints, listViews, myTasks, projectMembers, unreadCounts, workspaceName } from "@/lib/queries";
import { Workspace } from "@/components/workspace";
import { aiConfig, aiSettings } from "@/lib/ai";

export default async function BoardPage({ searchParams }: PageProps<"/board">) {
  const user = await currentUser();
  if (!user) redirect("/login");
  const ws = user.workspace_id;

  const [projects, { project: wanted, sheet, tag, task, section, chat }] = await Promise.all([
    listProjects(ws, user.id, user.is_admin === 1),
    searchParams,
  ]);
  const project = projects.find((p) => p.id === wanted) ?? projects[0] ?? null;
  // Independent reads, so they share the pool instead of queuing one after another.
  const [workspace, ai, columns, members, assignments, presence, feed, notifications, unread, mine, meetings, stats, sheets, views, fields, tags, sprints] =
    await Promise.all([
      workspaceName(ws),
      aiConfig(ws),
      project ? getBoard(project.id) : [],
      listMembers(ws),
      projectMembers(ws),
      listMembersWithPresence(ws),
      activityFeed(ws, user.id, user.is_admin),
      activityNotifications(ws, user.id, user.is_admin),
      unreadCounts(ws, user.id),
      myTasks(user.id),
      listMeetings(ws),
      project ? analytics(project.id) : null,
      project ? listCanvases(project.id) : [],
      project ? listViews(project.id) : [],
      project ? listFields(project.id) : [],
      listCanvasTags(projects.map((p) => p.id)),
      project ? listSprints(project.id) : [],
    ]);

  return (
    <Workspace
      user={user}
      workspace={workspace}
      projects={projects}
      project={project}
      columns={columns}
      members={members}
      assignments={assignments}
      presence={presence}
      feed={feed}
      notifications={notifications}
      unread={unread}
      mine={mine}
      meetings={meetings}
      stats={stats}
      sheets={sheets}
      views={views}
      fields={fields}
      sprints={sprints}
      tags={tags}
      focus={typeof sheet === "string" && typeof tag === "string" ? { sheetId: sheet, tag } : null}
      openTask={typeof task === "string" ? task : null}
      openSection={typeof section === "string" ? { section, chat: typeof chat === "string" ? chat : null } : null}
      today={new Date().toISOString().slice(0, 10)}
      aiEnabled={!!ai}
      // The key never leaves the server; only admins see the rest.
      ai={user.is_admin === 1 ? aiSettings(ai) : null}
      dark={(await cookies()).get("theme")?.value === "dark"}
    />
  );
}
