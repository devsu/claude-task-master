import fs from 'fs';
import path from 'path';
import chalk from 'chalk';
import ora from 'ora';
import { readJSON, writeJSON, log, findProjectRoot, findTasksJsonPath } from '../utils.js';
import { generateTextService } from '../ai-services-unified.js';
import { getProjectName, getDebugFlag } from '../config-manager.js';
import generateClarifyingQuestions from './generate-clarifying-questions.js';

/**
 * Attempts to fix common JSON errors from AI responses.
 * @param {string} jsonString The potentially malformed JSON string.
 * @returns {string} A cleaner JSON string.
 */
function fixMalformedJson(jsonString) {
    let cleaned = jsonString.trim();

    // 1. Remove markdown fences and surrounding text that is not a JSON object.
    const jsonStartIndex = cleaned.indexOf('{');
    const jsonEndIndex = cleaned.lastIndexOf('}');
    if (jsonStartIndex !== -1 && jsonEndIndex !== -1) {
        cleaned = cleaned.substring(jsonStartIndex, jsonEndIndex + 1);
    } else {
        // If no object is found, return the original string for the parser to fail with a clear message.
        return jsonString;
    }

    // 2. Remove trailing commas from objects and arrays.
    // This is a common error from LLMs.
    cleaned = cleaned.replace(/,\s*([}\]])/g, '$1');

    // 3. Attempt to fix unquoted or single-quoted keys.
    // This specifically targets the "Expected double-quoted property name" error.
    // It looks for a key (alphanumeric, _, -) that is not inside double quotes
    // and is followed by a colon.
    cleaned = cleaned.replace(/([{,]\s*)(\w+)\s*:/g, '$1"$2":'); // Unquoted keys
    cleaned = cleaned.replace(/([{,]\s*)'([^']+)'\s*:/g, '$1"$2":'); // Single-quoted keys

    return cleaned;
}

async function analyzeTaskComplexity(options, context = {}) {
	const { session, mcpLog } = context;
	const { research, output, from, to, id, clarify } = options;

	const outputFormat = mcpLog ? 'json' : 'text';
	const reportLog = (message, level = 'info') => {
		if (mcpLog) {
			mcpLog[level](message);
		} else if (outputFormat === 'text') {
			log(level, message);
		}
	};

	const spinner = outputFormat === 'text' ? ora('Analyzing the complexity of your tasks with AI...').start() : null;
    const debug = getDebugFlag(session);

	try {
		const projectRoot = findProjectRoot();
		if (!projectRoot) {
			throw new Error('Could not determine project root. Please run `task-master init` first.');
		}

		const tasksPath = findTasksJsonPath(projectRoot);
		reportLog(`Reading tasks from ${path.relative(projectRoot, tasksPath)}...`);

		const tasksData = readJSON(tasksPath, projectRoot);
		if (!tasksData || !tasksData.tasks) {
			throw new Error('No tasks found or tasks file is invalid.');
		}

		let tasksToAnalyze = tasksData.tasks;
		reportLog(`Found ${tasksToAnalyze.length} total tasks in the task file.`);

		const reportPath = output ? path.resolve(projectRoot, output) : path.join(projectRoot, '.taskmaster', 'reports', 'task-complexity-report.json');
		let existingReport = { meta: {}, complexityAnalysis: [] };
		if (fs.existsSync(reportPath)) {
			existingReport = readJSON(reportPath) || existingReport;
			reportLog(`Found existing complexity report at ${path.relative(projectRoot, reportPath)}`);
			reportLog(`Existing report contains ${existingReport.complexityAnalysis.length} task analyses`);
		}

		const systemPrompt = `You are an expert software engineering lead. Your task is to analyze a list of software development tasks and provide a complexity analysis.

Analyze each task based on the following criteria:
- Uniqueness and Novelty: Is this a routine task or something new?
- Dependencies: How many other tasks or external systems does it depend on?
- Technical Uncertainty: Are there unknown technical challenges?
- Scope and Size: How large is the task?

Your response MUST be a single, valid JSON object and nothing else. The JSON object must contain a single key "complexityAnalysis", which is an array of objects.
For each task provided, create an object in the array with the following keys, ensuring all keys and string values are enclosed in double quotes:
- "taskId": (number) The ID of the task.
- "taskTitle": (string) The title of the task.
- "complexityScore": (number) A score from 1 (trivial) to 10 (highly complex).
- "estimatedHours": (number) A rough estimate of the time in hours to complete the task.
- "reasoning": (string) A brief explanation for the score.
- "recommendedSubtasks": (number) A suggested number of subtasks to break it down into.
- "expansionPrompt": (string) A concise prompt for a separate AI to use to expand this task into subtasks.

IMPORTANT: Your output must be ONLY the JSON object. Do not include any other text, explanations, or markdown fences. The JSON must be perfectly formed, with double-quoted keys and string values, and no trailing commas.

EXAMPLE of a PERFECT response for a single task:
{
  "complexityAnalysis": [
    {
      "taskId": 101,
      "taskTitle": "Example Task",
      "complexityScore": 5,
      "estimatedHours": 8,
      "reasoning": "This is a sample reasoning.",
      "recommendedSubtasks": 3,
      "expansionPrompt": "Break down the example task."
    }
  ]
}`;

		const userPrompt = `Analyze the following tasks and return the complexity analysis in the specified JSON format:\n\n${JSON.stringify(tasksToAnalyze, null, 2)}`;

		if (debug) {
			reportLog(`System Prompt:\n${systemPrompt}`, 'debug');
			reportLog(`User Prompt:\n${userPrompt}`, 'debug');
		}

		const aiResponse = await generateTextService({
			prompt: userPrompt,
			systemPrompt: systemPrompt,
			role: 'main',
			session: session,
			projectRoot: projectRoot,
			commandName: 'analyze-complexity',
			outputType: outputFormat,
			useResearch: research
		});

		if (spinner) spinner.text = 'AI service call complete. Parsing response...';

		const cleanedJsonString = fixMalformedJson(aiResponse.mainResult);

		let analysisResult;
		try {
			reportLog('Parsing complexity analysis from text response...', 'info');
			analysisResult = JSON.parse(cleanedJsonString);
		} catch (parseError) {
			reportLog(`Error parsing complexity analysis JSON: ${parseError.message}`, 'error');
			if (debug) {
				reportLog(`Original AI response:\n${aiResponse.mainResult}`, 'debug');
                reportLog(`Cleaned AI response that failed parsing:\n${cleanedJsonString}`, 'debug');
			}
			throw new Error(`Error parsing complexity analysis JSON: ${parseError.message}`);
		}

		const newAnalysis = analysisResult.complexityAnalysis || [];

		const totalEstimatedHours = newAnalysis.reduce((sum, task) => sum + (task.estimatedHours || 0), 0);

		const finalReport = {
			meta: {
				...existingReport.meta,
				generatedAt: new Date().toISOString(),
				tasksAnalyzed: newAnalysis.length,
				totalTasks: tasksToAnalyze.length,
				analysisCount: (existingReport.meta.analysisCount || 0) + 1,
				thresholdScore: options.threshold || 5,
				projectName: getProjectName(),
				usedResearch: research || false,
				totalEstimatedHours: totalEstimatedHours,
			},
			complexityAnalysis: newAnalysis
		};

		const reportDir = path.dirname(reportPath);
		if (!fs.existsSync(reportDir)) {
			fs.mkdirSync(reportDir, { recursive: true });
		}

		writeJSON(reportPath, finalReport, projectRoot);

		if (spinner) spinner.succeed(chalk.green(`Complexity analysis complete. Report saved to ${path.relative(projectRoot, reportPath)}`));

		const complexTasks = tasksToAnalyze.filter(task =>
				newAnalysis.some(analysis => analysis.taskId === task.id && analysis.complexityScore >= (finalReport.meta.thresholdScore || 5))
			);

		if (clarify) {
			reportLog('Proceeding to generate clarifying questions for complex tasks...', 'info');
			if (spinner) spinner.text = 'Generating clarifying questions for complex tasks...';
			if (complexTasks.length > 0) {
				await generateClarifyingQuestions({ tasksData: { tasks: complexTasks } }, context);
			} else {
				reportLog('No tasks met the complexity threshold for clarification.', 'info');
			}
		}

		return { success: true, data: { reportPath, analysis: newAnalysis } };

	} catch (error) {
		if (spinner) spinner.fail(chalk.red(error.message));
		reportLog(`Error analyzing task complexity: ${error.message}`, 'error');
		if (debug) {
			console.error(error);
		}
		return { success: false, error: error.message };
	}
}

export default analyzeTaskComplexity;
