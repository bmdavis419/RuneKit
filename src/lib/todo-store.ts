export type Todo = { id: string; text: string; done: boolean; createdAt: number };

const todos: Todo[] = [
	{ id: '1', text: 'Try out the signal tracker', done: false, createdAt: Date.now() - 3000 },
	{ id: '2', text: 'Check the route tracker dashboard', done: false, createdAt: Date.now() - 2000 },
	{ id: '3', text: 'Add a new todo item', done: false, createdAt: Date.now() - 1000 }
];

export const getAll = () => [...todos];

export const add = (text: string) => {
	todos.push({ id: crypto.randomUUID(), text, done: false, createdAt: Date.now() });
};

export const toggle = (id: string) => {
	const t = todos.find((t) => t.id === id);
	if (t) t.done = !t.done;
};

export const remove = (id: string) => {
	const i = todos.findIndex((t) => t.id === id);
	if (i !== -1) todos.splice(i, 1);
};
