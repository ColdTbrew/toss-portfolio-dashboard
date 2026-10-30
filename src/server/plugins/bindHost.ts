import { definePlugin } from "nitro";
import { validateBindHost } from "../bindHost";

export default definePlugin(() => {
	validateBindHost(process.env);
});
