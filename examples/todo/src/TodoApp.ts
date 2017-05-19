import {combine, fromMaybe, lift, Maybe, traverse, fgo} from "@funkia/jabz";
import {
  Behavior, scan, map, sample, snapshot, Stream, switchStream,
  combineList, async, Future, switcher, plan, performStream, changes,
  snapshotWith
} from "@funkia/hareactive";
import {modelView, elements, list} from "../../../src";
const {h1, p, header, footer, section, checkbox, ul} = elements;

import todoInput, {Out as InputOut} from "./TodoInput";
import item, {Output as ItemOut, Input as ItemParams, itemIdToPersistKey} from "./Item";
import todoFooter, { Params as FooterParams } from "./TodoFooter";
import {setItemIO, itemBehavior, removeItemsIO} from "./localstorage";

const isEmpty = (list: any[]) => list.length === 0;
const apply = <A>(f: (a: A) => A, a: A) => f(a);
const contains = <A>(a: A, list: A[]) => list.indexOf(a) !== -1;

type FromView = {
  toggleAll: Stream<boolean>,
  itemOutputs: Behavior<ItemOut[]>,
  clearCompleted: Stream<{}>
} & InputOut;

type ToView = {
  toggleAll: Stream<boolean>,
  todoNames: Behavior<ItemParams[]>,
  itemOutputs: Behavior<ItemOut[]>,
  areAllCompleted: Behavior<boolean>
} & FooterParams;

// A behavior representing the current value of the localStorage property
const todoListStorage = itemBehavior("todoList");

export function mapTraverseFlat<A, B>(fn: (a: A) => Behavior<B>, behavior: Behavior<A[]>): Behavior<B[]> {
  return behavior.map(l => traverse(Behavior, fn, l)).flatten<B[]>();
}

function getCompletedIds(outputs: Behavior<ItemOut[]>): Behavior<number[]> {
  return mapTraverseFlat(
    ({completed: completedB, id}) => map((completed) => ({completed, id}), completedB),
    outputs
  ).map((list) => list.filter(((o) => o.completed)).map((o) => o.id));
}

type ModifyingListModel<A, B> = {
  addS: Stream<A>,
  removeKeyListS: Stream<B[]>,
  itemToKey: (a: A) => B,
  initial: A[]
};
// This model handles the modification of the list of Todos
function modifyingListModel<A, B>({ addS, removeKeyListS, itemToKey, initial }: ModifyingListModel<A, B>) {
  const prependS = addS.map(item => (list: A[]) => combine([item], list));
  const removeS = removeKeyListS.map(keys => (list: A[]) => list.filter(item => !contains(itemToKey(item), keys)));
  const modifications = combine(removeS, prependS);
  return sample(scan(apply, initial, modifications));
}

function* model({enterTodoS, toggleAll, clearCompleted, itemOutputs}: FromView) {
  const nextId = itemOutputs.map((outs) => outs.reduce((maxId, {id}) => Math.max(maxId, id), 0) + 1);

  const newTodoS: Stream<ItemParams> = snapshotWith((name, id) => ({name, id}), nextId, enterTodoS);
  const deleteS = switchStream(itemOutputs.map((list) => combineList(list.map((o) => o.destroyItemId))));
  const completedIds = getCompletedIds(itemOutputs);

  const savedTodoName: ItemParams[] = yield sample(todoListStorage);
  const restoredTodoName = savedTodoName === null ? [] : savedTodoName;

  const getItemId = ({id}: ItemParams) => id;

  const clearCompletedIdS = snapshot(completedIds, clearCompleted);
  const removeListS = combine(deleteS.map(a => [a]), clearCompletedIdS);
  const todoNames = yield modifyingListModel({
    addS: newTodoS,
    removeKeyListS: removeListS,
    itemToKey: getItemId,
    initial: restoredTodoName
  });

  yield performStream(clearCompletedIdS.map(ids => removeItemsIO(ids.map(itemIdToPersistKey))));
  yield performStream(changes(todoNames).map((n) => setItemIO("todoList", n)));

  const areAllCompleted =
    lift((currentIds, currentOuts) => currentIds.length === currentOuts.length, completedIds, itemOutputs);
  const areAnyCompleted = completedIds.map(isEmpty).map((b) => !b);

  return {itemOutputs, todoNames, clearAll: clearCompleted, areAnyCompleted, toggleAll, areAllCompleted};
}

function view({itemOutputs, todoNames, areAnyCompleted, toggleAll, areAllCompleted}: ToView) {
  return [
    section({class: "todoapp"}, [
      header({class: "header"}, [
        h1("todos"),
        todoInput
      ]),
      section({
        class: "main",
        classToggle: {hidden: todoNames.map(isEmpty)}
      }, [
        checkbox({
          class: "toggle-all",
          props: {checked: areAllCompleted},
          output: {toggleAll: "checkedChange"}
        }),
        ul(
          {class: "todo-list"},
          list((n) => item(toggleAll, n), todoNames, "itemOutputs", (o) => o.id)
        )
      ]),
      todoFooter({todosB: itemOutputs, areAnyCompleted})
    ]),
    footer({class: "info"}, [
      p("Double-click to edit a todo"),
      p("Written with Turbine"),
      p("Part of TodoMVC")
    ])
  ];
}

export const app = modelView(model, view)();
