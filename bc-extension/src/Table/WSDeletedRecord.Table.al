/// <summary>
/// Log of deleted records for delta sync. BC APIs do not expose deletions,
/// so the Monteur-App reads this table via the deletedRecords API page.
/// </summary>
table 50100 "WS Deleted Record"
{
    Caption = 'Werkstatt gelöschter Datensatz';
    DataClassification = SystemMetadata;

    fields
    {
        field(1; "Entry No."; BigInteger)
        {
            Caption = 'Lfd. Nr.';
            AutoIncrement = true;
        }
        field(2; "Table No."; Integer)
        {
            Caption = 'Tabellennr.';
        }
        field(3; "Record SystemId"; Guid)
        {
            Caption = 'Datensatz-SystemId';
        }
        field(4; "Deleted At"; DateTime)
        {
            Caption = 'Gelöscht am';
        }
    }

    keys
    {
        key(PK; "Entry No.")
        {
            Clustered = true;
        }
        key(DeletedAt; "Deleted At")
        {
        }
    }
}
