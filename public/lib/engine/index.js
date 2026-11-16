/**
 * Punto de entrada unificado de los motores visuales (View Engine Suite).
 */
export { mountFormFields } from './formEngine.js';
export { mountMultiSelect, mountCombobox } from '../autocomplete.js';
export {
  renderDataTable,
  attachBulkSelection,
  observeTableBulkSelection,
} from './tableEngine.js';
export {
  renderKpiStrip,
  renderFilterBar,
  renderViewSwitcher,
  mountPageView,
} from './layoutEngine.js';
export {
  renderGroupedList,
  renderHierarchyTree,
  renderKanbanBoard,
  renderGanttChart,
} from './viewsEngine.js';
export { renderMatrixTable } from './matrixEngine.js';
export { renderComboFlowChart } from './chartEngine.js';
export { mountDetailView } from './detailEngine.js';
export {
  createModal,
  showAlertModal,
  showConfirmModal,
  showPromptModal,
  showFormModal,
} from './modalEngine.js';
