import pathlib

p = pathlib.Path(r'packages/opencode-adapter/src/agents/agent-builder.ts')
s = p.read_text(encoding='utf-8')

old = """  // Append skill content if provided
  if (skillContent) {
    const instructions: string = String(agentConfig.instructions || agentConfig.prompt || '');
    if (!instructions.includes('Skill-Specific Instructions')) {
      agentConfig.instructions = instructions + '\\n\\n---\\n\\n## Skill-Specific Instructions\\n\\n' + skillContent;
    }
  }

  return agentConfig;
}"""

new = """  agentConfig = applySkillContent(agentConfig, skillContent);

  return agentConfig;
}"""

if old in s:
    s = s.replace(old, new)
    print('replaced createAgent skill block')
else:
    print('createAgent skill block not found')

old2 = """    // Append skill content if provided
    if (content) {
      const instructions: string = String(agents[name].instructions || agents[name].prompt || '');
      if (!instructions.includes('Skill-Specific Instructions')) {
        agents[name].instructions = instructions + '\\n\\n---\\n\\n## Skill-Specific Instructions\\n\\n' + content;
      }
    }"""

new2 = """    agents[name] = applySkillContent(agents[name], content);"""

if old2 in s:
    s = s.replace(old2, new2)
    print('replaced createAllAgents skill block')
else:
    print('createAllAgents skill block not found')

# Add helper function before createAgent
helper = """/**
 * Append skill content to agent instructions if not already present.
 */
function applySkillContent(agentConfig: AgentConfig, skillContent?: string): AgentConfig {
  if (!skillContent) return agentConfig;
  const instructions: string = String(agentConfig.instructions || agentConfig.prompt || '');
  if (!instructions.includes('Skill-Specific Instructions')) {
    agentConfig.instructions = instructions + '\\n\\n---\\n\\n## Skill-Specific Instructions\\n\\n' + skillContent;
  }
  return agentConfig;
}

"""

if 'function applySkillContent' not in s:
    s = s.replace('export async function createAgent(', helper + 'export async function createAgent(')
    print('added helper function')

p.write_text(s, encoding='utf-8')
print('done')
