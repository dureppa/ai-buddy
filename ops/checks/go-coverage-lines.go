// Reports source lines represented by executable tokens in a go test profile.
package main

import (
	"bufio"
	"fmt"
	"go/scanner"
	"go/token"
	"log"
	"os"
	"path/filepath"
	"strings"
)

type block struct {
	start, end int
	covered    bool
}

func main() {
	if len(os.Args) != 3 {
		log.Fatal("usage: go run go-coverage-lines.go <coverage-profile> <module-path>")
	}
	profile, err := os.Open(os.Args[1])
	check(err)
	defer profile.Close()

	files := map[string][]block{}
	input := bufio.NewScanner(profile)
	for input.Scan() {
		if strings.HasPrefix(input.Text(), "mode: ") {
			continue
		}
		name, fields, ok := strings.Cut(input.Text(), ":")
		local, inModule := strings.CutPrefix(name, os.Args[2]+"/")
		if !ok || !inModule {
			log.Fatalf("coverage entry outside module: %s", name)
		}
		var startLine, startCol, endLine, endCol, statements, count int
		_, err := fmt.Sscanf(fields, "%d.%d,%d.%d %d %d", &startLine, &startCol, &endLine, &endCol, &statements, &count)
		check(err)
		if statements > 0 {
			const columnScale = 1 << 20
			files[local] = append(files[local], block{
				start:   startLine*columnScale + startCol,
				end:     endLine*columnScale + endCol,
				covered: count > 0,
			})
		}
	}
	check(input.Err())

	covered, total := 0, 0
	for name, blocks := range files {
		lines := executableLines(filepath.FromSlash(name), blocks)
		total += len(lines)
		for _, hit := range lines {
			if hit {
				covered++
			}
		}
	}
	if total == 0 {
		log.Fatal("no executable lines found")
	}
	fmt.Printf("Go lines: %d/%d (%.2f%%)\n", covered, total, 100*float64(covered)/float64(total))
}

func executableLines(path string, blocks []block) map[int]bool {
	source, err := os.ReadFile(path)
	check(err)
	file := token.NewFileSet().AddFile(path, -1, len(source))
	var scan scanner.Scanner
	scan.Init(file, source, func(pos token.Position, message string) {
		log.Fatalf("%s: %s", pos, message)
	}, 0)

	lines := map[int]bool{}
	for {
		position, kind, _ := scan.Scan()
		switch kind {
		case token.EOF:
			return lines
		case token.LBRACE, token.RBRACE, token.LPAREN, token.RPAREN,
			token.LBRACK, token.RBRACK, token.COMMA, token.SEMICOLON, token.COLON:
			continue
		}
		pos := file.PositionFor(position, false)
		offset := pos.Line*(1<<20) + pos.Column
		for _, b := range blocks {
			if b.start <= offset && offset < b.end {
				lines[pos.Line] = lines[pos.Line] || b.covered
			}
		}
	}
}

func check(err error) {
	if err != nil {
		log.Fatal(err)
	}
}
