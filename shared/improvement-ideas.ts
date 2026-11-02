export type ImprovementIdeaStatus = 'proposed' | 'later' | 'starting' | 'started';
export type ImprovementIdea = {
  id: number;
  sessionId: string;
  projectName: string;
  text: string;
  status: ImprovementIdeaStatus;
  createdAt: string;
  vaultPath: string | null;
  vaultError: string | null;
};
