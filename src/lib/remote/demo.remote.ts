import { query } from '$app/server';

export const queryGetFakeData = query(() => {
	return {
		name: 'John Doe',
		age: 30,
		email: 'john.doe@example.com'
	};
});
