// 筛选值类型与默认值已迁至 lib/data（供视图模型无组件依赖地引用，见 DESKTOP_UI_PLAN.md D5）。
// 此处保留再导出，兼容仍从 @/components/business 引用的既有组件。
export {
  type BusinessFilterValue,
  type FilterField,
  defaultFilterValue,
} from "@/lib/data/filter-types";
