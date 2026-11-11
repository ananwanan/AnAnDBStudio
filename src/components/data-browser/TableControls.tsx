import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import type { FilterOperator, FilterValue, TableRequest } from "@/services/browse-protocol";

const OPERATORS: ReadonlyArray<[FilterOperator, string]> = [
  ["eq", "="], ["ne", "≠"], ["gt", ">"], ["lt", "<"], ["ge", "≥"], ["le", "≤"],
  ["contains", "包含文本"], ["like", "LIKE"], ["isNull", "IS NULL"], ["isNotNull", "IS NOT NULL"],
];
const inputClass = "max-w-40 rounded border bg-background px-1.5 py-0.5 text-xs";

export interface TableOptions {
  sort: TableRequest["sort"];
  filter: TableRequest["filter"];
}

export function TableControls({ columns, onApply, onRefresh }: {
  columns: string[];
  onApply: (options: TableOptions) => void;
  onRefresh: () => void;
}) {
  const [sortIndex, setSortIndex] = useState("");
  const [descending, setDescending] = useState(false);
  const [filterIndex, setFilterIndex] = useState("");
  const [operator, setOperator] = useState<FilterOperator>("eq");
  const [type, setType] = useState<FilterValue["type"]>("text");
  const [value, setValue] = useState("");
  const usesValue = operator !== "isNull" && operator !== "isNotNull";
  const textOnly = operator === "contains" || operator === "like";
  const column = (index: string) => index === "" ? undefined : columns[Number(index)];
  const columnOptions = columns.map((name, index) => <option key={index} value={index}>{name || '""'}</option>);

  function apply(event: FormEvent) {
    event.preventDefault();
    const sortColumn = column(sortIndex);
    const filterColumn = column(filterIndex);
    onApply({
      sort: sortColumn === undefined ? null : { column: sortColumn, descending },
      filter: filterColumn === undefined ? null : {
        column: filterColumn, operator, value: usesValue ? { type: textOnly ? "text" : type, value } : null,
      },
    });
  }

  return (
    <form onSubmit={apply} className="flex min-w-0 flex-wrap items-center gap-1">
      <select aria-label="排序列" className={inputClass} value={sortIndex} onChange={event => setSortIndex(event.target.value)}>
        <option value="">排序列</option>{columnOptions}
      </select>
      <select aria-label="排序方向" className={inputClass} value={descending ? "desc" : "asc"} disabled={sortIndex === ""} onChange={event => setDescending(event.target.value === "desc")}>
        <option value="asc">升序</option><option value="desc">降序</option>
      </select>
      <select aria-label="筛选列" className={inputClass} value={filterIndex} onChange={event => setFilterIndex(event.target.value)}>
        <option value="">筛选列</option>{columnOptions}
      </select>
      <select aria-label="筛选运算符" className={inputClass} value={operator} disabled={filterIndex === ""} onChange={event => setOperator(event.target.value as FilterOperator)}>
        {OPERATORS.map(([operation, label]) => <option key={operation} value={operation}>{label}</option>)}
      </select>
      {filterIndex !== "" && usesValue && <>
        <select aria-label="筛选值类型" className={inputClass} value={textOnly ? "text" : type} disabled={textOnly} onChange={event => setType(event.target.value as FilterValue["type"])}>
          <option value="text">TEXT</option><option value="integer">INTEGER</option>
          <option value="real">REAL</option><option value="blob">BLOB (hex)</option>
        </select>
        <input aria-label="筛选值" className={inputClass} maxLength={32768} value={value} onChange={event => setValue(event.target.value)} />
      </>}
      <Button size="xs" type="submit" variant="outline" disabled={columns.length === 0}>应用</Button>
      <Button size="xs" type="button" variant="ghost" onClick={() => {
        setSortIndex(""); setFilterIndex(""); setValue(""); onApply({ sort: null, filter: null });
      }}>清除</Button>
      <Button size="xs" type="button" variant="ghost" onClick={onRefresh}>刷新</Button>
    </form>
  );
}
