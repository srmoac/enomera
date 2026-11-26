import { handleApiRequest } from '../server/router.mjs';

export default async function handler(req, res) {
  return handleApiRequest(req, res);
}
