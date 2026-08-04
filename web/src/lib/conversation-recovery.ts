type ConversationIdentity = {
  id: string
}

type ProjectConversationState<TConversation extends ConversationIdentity> = {
  activeConversationId: string
  conversations: TConversation[]
}

export function recoverProjectConversationState<
  TConversation extends ConversationIdentity,
  TProject extends ProjectConversationState<TConversation>,
>(project: TProject, createConversation: () => TConversation): TProject {
  if (project.conversations.length === 0) {
    const conversation = createConversation()
    return {
      ...project,
      activeConversationId: conversation.id,
      conversations: [conversation],
    }
  }

  if (
    project.conversations.some(
      (conversation) => conversation.id === project.activeConversationId,
    )
  ) {
    return project
  }

  return {
    ...project,
    activeConversationId: project.conversations[0].id,
  }
}
