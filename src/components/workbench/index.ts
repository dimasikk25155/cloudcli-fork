import './builtinTabs';
import './sidechat/registerSideChatTabs';
import './artifacts/artifactTabs';
import './advisor/registerAdvisorTab';
import './projectTabs';
export { default as WorkbenchCanvas } from './WorkbenchCanvas';
export { default as WorkbenchLayout } from './WorkbenchLayout';
export { default as WorkbenchToggle } from './WorkbenchToggle';
export {
  closeWorkbenchTab,
  openNewWorkbenchTab,
  openWorkbenchTab,
  replaceWorkbenchTab,
  useWorkbench,
  useWorkbenchAccountSync,
  workbenchStore,
} from './useWorkbench';
export type { UseWorkbench } from './useWorkbench';
export {
  getWorkbenchTabKind,
  listWorkbenchTabKinds,
  registerWorkbenchTabKind,
} from './workbenchTabs';
export type {
  WorkbenchRenderContext,
  WorkbenchTab,
  WorkbenchTabInput,
  WorkbenchTabKind,
  WorkbenchTabKindDef,
} from './workbenchTabs';
