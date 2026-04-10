"""Simple targeted fix: rebuild entire TOOLS_SCHEMA ProposePPTPlan parameters block."""
with open('app/services/llm_service.py', 'r', encoding='latin-1') as f:
    content = f.read()

# Find where ProposePPTPlan "parameters": starts
params_start = content.find('"parameters": {\r\n                "type": "object",\r\n                "properties": {\r\n                    "plan_markdown"')
if params_start == -1:
    params_start = content.find('"parameters": {\n                "type": "object",\n                "properties": {\n                    "plan_markdown"')

print('params_start:', params_start)

# Find end of ProposePPTPlan block (first "required" after params_start)
req_pos = content.find('"required": ["plan_markdown", "total_pages"]', params_start)
print('req_pos:', req_pos)

# Find where the block closes after "required"
close_pos = content.find('}\n    },\n', req_pos)
if close_pos == -1:
    close_pos = content.find('}\r\n    },\r\n', req_pos)
print('close_pos:', close_pos)

if params_start != -1 and req_pos != -1:
    end_pos = req_pos + len('"required": ["plan_markdown", "total_pages"]')
    old = content[params_start:end_pos]
    print('Old block len:', len(old))
    print('Old block preview:', repr(old[:200]))
    
    new_block = (
        '"parameters": {\r\n'
        '                "type": "object",\r\n'
        '                "properties": {\r\n'
        '                    "plan_markdown": {\r\n'
        '                        "type": "string",\r\n'
        '                        "description": (\r\n'
        '                            "PPT\u5e03\u5c40\u65b9\u6848\uff0cMarkdown\u683c\u5f0f\u3002\u6bcf\u9875\u4e00\u884c\u3002"\r\n'
        '                            "\u5e03\u5c40\u7c7b\u578b\u53ea\u80fd\u4ece cover/minimal_list/two_column/stat_callout/timeline \u8fd95\u79cd\u4e2d\u9009\uff0c\u7981\u6b62\u4f7f\u7528\u5176\u4ed6\u540d\u79f0\u3002"\r\n'
        '                            "\u793a\u4f8b\uff1a\\\\n"\r\n'
        '                            "**P1** [cover] \u8bfe\u7a0b\u5927\u6807\u9898 \u2014\u2014 \u5168\u5e45\u6807\u9898+\u526f\u6807\u9898\u5c45\u4e2d\\\\n"\r\n'
        '                            "**P2** [minimal_list] \u6559\u5b66\u76ee\u6807 \u2014\u2014 \u5de6\u4e0a\uff1a\u6807\u9898\uff1b\u5168\u5e45\uff1a3-4\u6761\u8981\u70b9\u5217\u8868\\\\n"\r\n'
        '                            "**P3** [two_column] \u539f\u7406\u5bf9\u6bd4 \u2014\u2014 \u5de6\uff1a3\u6761\u6587\u5b57\u5217\u8868\uff1b\u53f3\uff1a\u914d\u56fe\\\\n"\r\n'
        '                            "**P4** [stat_callout] \u6838\u5fc3\u6570\u636e \u2014\u2014 \u5c45\u4e2d\u5927\u6570\u5b57\u300c98%\u300d+\u8bf4\u660e\u6587\u5b57\\\\n"\r\n'
        '                            "**P5** [timeline] \u53d1\u5c55\u5386\u7a0b \u2014\u2014 \u5de6\u5230\u53f3\uff1a4\u4e2a\u65f6\u95f4\u8282\u70b9\u5361\u7247\\\\n"\r\n'
        '                            "(\u4e0d\u9700\u8981\u5199\u5177\u4f53\u6587\u5b57\u5185\u5bb9\uff0c\u53ea\u63cf\u8ff0\u5143\u7d20\u6570\u91cf\u300116\u6392\u5217\u65b9\u5f0f\u548c\u4f4d\u7f6e\uff0c\u7981\u6b62\u4f7f\u7528\u4ee5\u4e0a5\u79cd\u4e4b\u5916\u7684\u5e03\u5c40\u540d)"\r\n'
        '                        )\r\n'
        '                    },\r\n'
        '                    "total_pages": {\r\n'
        '                        "type": "integer",\r\n'
        '                        "description": "\u9884\u8ba1\u751f\u6210\u7684\u5e7b\u706f\u7247\u603b\u9875\u6570\uff08\u5efa\u8bae6-12\u9875\uff09"\r\n'
        '                    }\r\n'
        '                },\r\n'
        '                "required": ["plan_markdown", "total_pages"]'
    )
    
    content_fixed = content[:params_start] + new_block + content[end_pos:]
    
    # Encode to UTF-8 (this will fail if any latin-1 chars aren't valid UTF-8 outside the replaced section)
    # First check: encode the fixed content
    try:
        content_fixed.encode('utf-8')
        with open('app/services/llm_service.py', 'w', encoding='utf-8') as f:
            f.write(content_fixed)
        print('SUCCESS: written as UTF-8')
        
        # Verify syntax
        import ast
        ast.parse(content_fixed)
        print('SYNTAX OK')
    except (UnicodeEncodeError, SyntaxError) as e:
        print('Error after fix:', e)
        # Show problematic area
        lines = content_fixed.split('\n')
        for i, line in enumerate(lines[35:50], 36):
            print(f'{i}: {repr(line[:80])}')
else:
    print('FAILED to find block')
    # Debug: show file structure
    lines = content.split('\n')
    for i, line in enumerate(lines[:50], 1):
        print(f'{i}: {repr(line[:80])}')
