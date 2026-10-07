import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { currentUser } from "@/lib/auth";
import { activityFeed, activityNotifications, analytics, getBoard, listCanvases, listMembers, listMembersWithPresence, listProjects, myTasks, projectMembers, unreadCounts, workspaceName } from "@/lib/queries";
import { Workspace } from "@/components/workspace";

export default async function BoardPage({ searchParams }: PageProps<"/board">) {
  const user = await currentUser();
  if (!user) redirect("/login");
  const ws = user.workspace_id;

  const projects = await listProjects(ws, user.id, user.is_admin === 1);
  const wanted = (await searchParams).project;
  const project = projects.find((p) => p.id === wanted) ?? projects[0] ?? null;
  const workspace = await workspaceName(ws);

  return (
    <Workspace
      user={user}
      workspace={workspace}
      projects={projects}
      project={project}
      columns={project ? await getBoard(project.id) : []}
      members={await listMembers(ws)}
      assignments={await projectMembers(ws)}
      presence={await listMembersWithPresence(ws)}
      feed={await activityFeed(ws, user.id, user.is_admin)}
      notifications={await activityNotifications(ws, user.id, user.is_admin)}
      unread={await unreadCounts(ws, user.id)}
      mine={await myTasks(user.id)}
      stats={project ? await analytics(project.id) : null}
      sheets={project ? await listCanvases(project.id) : []}
      today={new Date().toISOString().slice(0, 10)}
      dark={(await cookies()).get("theme")?.value === "dark"}
    />
  );
}
