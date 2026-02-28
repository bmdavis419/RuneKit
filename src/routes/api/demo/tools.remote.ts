export const greet = async (name = 'world') => ({
	message: `hello ${name}`,
	timestamp: Date.now()
});

export const sum = (...values: number[]) => values.reduce((total, value) => total + value, 0);
