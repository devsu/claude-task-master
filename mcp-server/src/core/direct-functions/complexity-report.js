import chalk from 'chalk';
import Table from 'cli-table3';
import { readComplexityReport, isSilentMode } from '../../utils.js';
import { COMPLEXITY_REPORT_FILE } from '../../../src/constants/paths.js';

/**
 * Displays the task complexity analysis report in a formatted table.
 * This is the user-facing command logic.
 * @param {Object} options - Command options.
 * @param {string} [options.file] - Path to the report file.
 * @param {Object} [context] - Context object, for MCP logging.
 */
async function complexityReport(options, context = {}) {
	const { mcpLog } = context;
	const reportPath = options.file || COMPLEXITY_REPORT_FILE;
	const outputFormat = mcpLog || isSilentMode() ? 'json' : 'text';

	try {
		const report = readComplexityReport(reportPath);

		if (!report || !report.complexityAnalysis || report.complexityAnalysis.length === 0) {
			const noReportMessage = `No complexity report found at ${reportPath}. Run 'task-master analyze-complexity' first.`;
			if (outputFormat === 'text') {
				console.log(chalk.yellow(noReportMessage));
			} else if (mcpLog) {
				mcpLog.warn(noReportMessage);
			}
			return { success: false, error: 'No report found.' };
		}

		const analysis = report.complexityAnalysis;

		// Sort by complexity score, highest to lowest
		analysis.sort((a, b) => b.complexityScore - a.complexityScore);

		if (outputFormat === 'text') {
			const table = new Table({
				head: [
					chalk.cyan('ID'),
					chalk.cyan('Task Title'),
					chalk.cyan('Complexity'),
					chalk.cyan('Estimate (hrs)'), // NEW COLUMN HEADER
					chalk.cyan('Subtasks'),
					chalk.cyan('Reasoning'),
				],
				colWidths: [8, 35, 12, 16, 10, 40], // Adjusted for new column
				wordWrap: true,
			});

			analysis.forEach((task) => {
				table.push([
					task.taskId,
					task.taskTitle,
					task.complexityScore,
					task.estimateHours || 'N/A', // NEW DATA POINT
					task.recommendedSubtasks,
					task.reasoning,
				]);
			});

			console.log(table.toString());

			// Display summary statistics
			const highComplexity = analysis.filter((t) => t.complexityScore >= 8).length;
			const mediumComplexity = analysis.filter((t) => t.complexityScore >= 5 && t.complexityScore < 8).length;
			const lowComplexity = analysis.filter((t) => t.complexityScore < 5).length;
			const totalEstimatedHours = analysis.reduce((sum, task) => {
				return sum + (Number(task.estimateHours) || 0);
			}, 0);

			console.log(chalk.green('\nComplexity Analysis Summary:'));
			console.log(`- Total Tasks Analyzed: ${analysis.length}`);
			console.log(`- High Complexity (>=8): ${highComplexity}`);
			console.log(`- Medium Complexity (5-7): ${mediumComplexity}`);
			console.log(`- Low Complexity (<5): ${lowComplexity}`);
			console.log(`- Total Estimated Hours: ${totalEstimatedHours.toFixed(1)}`); // NEW SUMMARY LINE
		}

		return { success: true, data: report };
	} catch (error) {
		const errorMessage = `Error displaying complexity report: ${error.message}`;
		if (outputFormat === 'text') {
			console.error(chalk.red(errorMessage));
		} else if (mcpLog) {
			mcpLog.error(errorMessage);
		}
		return { success: false, error: error.message };
	}
}

export default complexityReport;
