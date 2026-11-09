
import { Database, FileCode2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";

export function WelcomePanel() {
    return (
        <main className="h-full min-h-0 min-w-0 overflow-auto bg-background p-6">
            <div className="mx-auto max-w-4xl space-y-6">
                <div className="space-y-2">
                    <h1 className="text-2xl font-semibold tracking-tight">
                        Welcome to AnAnDB Studio
                    </h1>

                    <p className="text-sm text-muted-foreground">
                        A modern cross-platform database management studio.
                    </p>

                    <Badge variant="secondary">
                        M2.1 — SQL Editor
                    </Badge>
                </div>

                <div className="grid gap-4 xl:grid-cols-2">
                    <Card>
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2">
                                <Database className="size-5" />
                                Database Explorer
                            </CardTitle>
                            <CardDescription>
                                Database connections and schema management
                            </CardDescription>
                        </CardHeader>

                        <CardContent>
                            <p className="text-sm text-muted-foreground">
                                Open an existing SQLite database using the New Connection button, then browse its schema in Explorer.
                            </p>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2">
                                <FileCode2 className="size-5" />
                                SQL Editor
                            </CardTitle>
                            <CardDescription>
                                Query editing and execution
                            </CardDescription>
                        </CardHeader>

                        <CardContent>
                            <p className="text-sm text-muted-foreground">
                                Use New Query to open independent Monaco SQL tabs. SQL execution will be added in M2.2.
                            </p>
                        </CardContent>
                    </Card>
                </div>
            </div>
        </main>
    );
}
