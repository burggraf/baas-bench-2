export function preparedTemplateControllerDirectory(stdout) {
  return stdout.match(/(?:Fresh workload proof: |Baseline proof failed \([^\n]*?; inspect )(results\/baseline-[A-Za-z0-9]{6})(?=[\s.]|$)/)?.[1];
}
