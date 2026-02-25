export const GET = async () => {
	return new Response(
		JSON.stringify({
			name: 'John Doe',
			age: 30,
			email: 'john.doe@example.com'
		}),
		{
			headers: {
				'Content-Type': 'application/json'
			}
		}
	);
};
