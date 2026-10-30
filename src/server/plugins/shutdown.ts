import { definePlugin } from "nitro";
import { stopPortfolioService } from "../portfolioService";
import { getShutdownCoordinator } from "../shutdown";

export default definePlugin((app) => {
	const shutdown = getShutdownCoordinator(stopPortfolioService);
	app.hooks?.hook("close", shutdown);
});
