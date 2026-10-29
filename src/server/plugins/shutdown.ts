import { definePlugin } from "nitro";
import { getPortfolioService } from "../portfolioService";
import { getShutdownCoordinator } from "../shutdown";

export default definePlugin((app) => {
	const shutdown = getShutdownCoordinator(() => getPortfolioService().stop());
	app.hooks?.hook("close", shutdown);
});
