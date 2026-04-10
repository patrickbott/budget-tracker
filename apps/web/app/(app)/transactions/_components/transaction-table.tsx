"use client";

import { useState, useMemo } from "react";
import Decimal from "decimal.js";
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  flexRender,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { updateEntryLineCategory } from "../actions";

export interface TransactionRow {
  entryId: string;
  entryDate: string;
  description: string;
  isPending: boolean;
  /** The account-side line — amount + accountId + accountName */
  accountLineId: string;
  accountId: string;
  accountName: string;
  amount: string;
  /** The category-side line — for reassignment */
  categoryLineId: string;
  categoryId: string | null;
  categoryName: string | null;
  categoryColor: string | null;
}

export interface CategoryOption {
  id: string;
  name: string;
  color: string | null;
}

interface TransactionTableProps {
  data: TransactionRow[];
  categories: CategoryOption[];
  accounts: { id: string; name: string }[];
  /** Pre-filter to a single account (used on account detail page) */
  filterAccountId?: string;
}

function formatCurrency(amount: string): string {
  const d = new Decimal(amount);
  return d.toFixed(2);
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function TransactionTable({
  data,
  categories,
  accounts,
  filterAccountId,
}: TransactionTableProps) {
  const [sorting, setSorting] = useState<SortingState>([
    { id: "entryDate", desc: true },
  ]);
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [selectedAccount, setSelectedAccount] = useState(
    filterAccountId ?? "all",
  );
  const [selectedCategory, setSelectedCategory] = useState("all");

  const filteredData = useMemo(() => {
    let rows = data;

    if (selectedAccount !== "all") {
      rows = rows.filter((r) => r.accountId === selectedAccount);
    }

    if (selectedCategory === "uncategorized") {
      rows = rows.filter((r) => !r.categoryId);
    } else if (selectedCategory !== "all") {
      rows = rows.filter((r) => r.categoryId === selectedCategory);
    }

    if (dateFrom) {
      rows = rows.filter((r) => r.entryDate >= dateFrom);
    }
    if (dateTo) {
      rows = rows.filter((r) => r.entryDate <= dateTo);
    }

    if (search) {
      const lower = search.toLowerCase();
      rows = rows.filter((r) =>
        r.description.toLowerCase().includes(lower),
      );
    }

    return rows;
  }, [data, selectedAccount, selectedCategory, dateFrom, dateTo, search]);

  const columns = useMemo<ColumnDef<TransactionRow>[]>(
    () => [
      {
        accessorKey: "entryDate",
        header: "Date",
        cell: ({ getValue }) => formatDate(getValue<string>()),
        sortingFn: "alphanumeric",
      },
      {
        accessorKey: "description",
        header: "Description",
      },
      {
        accessorKey: "amount",
        header: "Amount",
        cell: ({ getValue }) => {
          const raw = getValue<string>();
          const d = new Decimal(raw);
          const formatted = formatCurrency(raw);
          const isPositive = d.gt(0);
          return (
            <span
              className={
                isPositive
                  ? "font-medium text-green-600 dark:text-green-400"
                  : "font-medium text-red-600 dark:text-red-400"
              }
            >
              {isPositive ? "+" : ""}
              {formatted}
            </span>
          );
        },
        sortingFn: (rowA, rowB) => {
          const a = new Decimal(rowA.getValue<string>("amount"));
          const b = new Decimal(rowB.getValue<string>("amount"));
          return a.comparedTo(b);
        },
      },
      {
        accessorKey: "accountName",
        header: "Account",
      },
      {
        id: "category",
        header: "Category",
        cell: ({ row }) => (
          <CategoryCell
            categoryLineId={row.original.categoryLineId}
            currentCategoryId={row.original.categoryId}
            categoryName={row.original.categoryName}
            categoryColor={row.original.categoryColor}
            categories={categories}
          />
        ),
      },
      {
        id: "status",
        header: "Status",
        cell: ({ row }) =>
          row.original.isPending ? (
            <Badge variant="outline">Pending</Badge>
          ) : null,
      },
    ],
    [categories],
  );

  const table = useReactTable({
    data: filteredData,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: {
      pagination: { pageSize: 50 },
    },
  });

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">
            Search
          </label>
          <Input
            placeholder="Filter descriptions..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-48"
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">
            From
          </label>
          <Input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="w-36"
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">
            To
          </label>
          <Input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="w-36"
          />
        </div>
        {!filterAccountId && (
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">
              Account
            </label>
            <Select value={selectedAccount} onValueChange={setSelectedAccount}>
              <SelectTrigger className="w-44">
                <SelectValue placeholder="All accounts" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All accounts</SelectItem>
                {accounts.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">
            Category
          </label>
          <Select
            value={selectedCategory}
            onValueChange={setSelectedCategory}
          >
            <SelectTrigger className="w-44">
              <SelectValue placeholder="All categories" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All categories</SelectItem>
              <SelectItem value="uncategorized">Uncategorized</SelectItem>
              {categories.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Table */}
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead
                    key={header.id}
                    className={
                      header.column.getCanSort()
                        ? "cursor-pointer select-none"
                        : ""
                    }
                    onClick={header.column.getToggleSortingHandler()}
                  >
                    {flexRender(
                      header.column.columnDef.header,
                      header.getContext(),
                    )}
                    {{ asc: " ↑", desc: " ↓" }[
                      header.column.getIsSorted() as string
                    ] ?? ""}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.length > 0 ? (
              table.getRowModel().rows.map((row) => (
                <TableRow key={row.id}>
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext(),
                      )}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  className="h-24 text-center text-muted-foreground"
                >
                  No transactions found.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {filteredData.length} transaction{filteredData.length !== 1 ? "s" : ""}
        </p>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
          >
            Previous
          </Button>
          <span className="text-sm text-muted-foreground">
            Page {table.getState().pagination.pageIndex + 1} of{" "}
            {table.getPageCount()}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => table.nextPage()}
            disabled={!table.getCanNextPage()}
          >
            Next
          </Button>
        </div>
      </div>
    </div>
  );
}

function CategoryCell({
  categoryLineId,
  currentCategoryId,
  categoryName,
  categoryColor,
  categories,
}: {
  categoryLineId: string;
  currentCategoryId: string | null;
  categoryName: string | null;
  categoryColor: string | null;
  categories: CategoryOption[];
}) {
  const [updating, setUpdating] = useState(false);

  async function handleChange(newCategoryId: string) {
    const catId = newCategoryId === "none" ? null : newCategoryId;
    setUpdating(true);
    await updateEntryLineCategory(categoryLineId, catId);
    setUpdating(false);
  }

  return (
    <Select
      value={currentCategoryId ?? "none"}
      onValueChange={handleChange}
      disabled={updating}
    >
      <SelectTrigger className="h-7 w-36 text-xs">
        <SelectValue>
          {currentCategoryId ? (
            <span className="flex items-center gap-1.5">
              {categoryColor && (
                <span
                  className="inline-block h-2 w-2 rounded-full"
                  style={{ backgroundColor: categoryColor }}
                />
              )}
              {categoryName}
            </span>
          ) : (
            <span className="text-muted-foreground">Uncategorized</span>
          )}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="none">Uncategorized</SelectItem>
        {categories.map((c) => (
          <SelectItem key={c.id} value={c.id}>
            <span className="flex items-center gap-1.5">
              {c.color && (
                <span
                  className="inline-block h-2 w-2 rounded-full"
                  style={{ backgroundColor: c.color }}
                />
              )}
              {c.name}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
