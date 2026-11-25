// Shared canonical table reads and mutation planning; both host lanes use one implementation.
export {
  tableNodes,
  tableRead,
  tableCellRead,
  planTableMutation,
  planInsertTable,
  nextParagraphSibling,
  type AutomationTableMutation,
  type AutomationTableRead,
  type AutomationTableCellRead,
  type TableMutationPlan,
} from '../store/store/table-authoring-plan.ts';
